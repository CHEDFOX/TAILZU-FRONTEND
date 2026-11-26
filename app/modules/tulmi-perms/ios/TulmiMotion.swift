import CoreMotion
import Foundation

/// MOTION & FITNESS (perms2/SPEC.md 5).
///
/// Two uses, one grant:
///
///   steps   a fitness bot the person made can count steps WITHOUT Apple Health. The phone answers with the same
///           daily summary Health sends: a day, its step count, and the walks, runs and rides of ten minutes or
///           more. No times finer than a day ever leave this file.
///   driving just before a Nudj call rings, the phone is asked whether it is in a car, and answers yes or no.
///           Nothing else, and nothing is kept.
///
/// What this deliberately does not do: no live updates (every read is a query over a window that has passed), no
/// background start, no places (CoreMotion has none to give), no automotive span in the daily summary, and no
/// reading at all unless `NSMotionUsageDescription` is in this binary — `abilities()` checks for it, because
/// calling CoreMotion without that key crashes the app.
final class TulmiMotion {
  private let pedometer = CMPedometer()
  private let activity = CMMotionActivityManager()
  /// CoreMotion hands its answers to a queue of our choosing; one serial queue keeps them in order.
  private let answers: OperationQueue = {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    return queue
  }()

  /// A walk, run or ride counts from ten minutes (5.1).
  private static let minMinutes = 10
  private static let maxDays = 31
  private static let maxSpans = 20
  /// The driving look-back, and the most a caller may ask for.
  private static let drivingWindow: Double = 180
  private static let maxDrivingWindow: Double = 900

  /// Whether this phone can count steps and notice walking at all (an iPad or an old iPod cannot).
  static func available() -> Bool {
    return CMPedometer.isStepCountingAvailable() && CMMotionActivityManager.isActivityAvailable()
  }

  // MARK: what the system says

  /// Never prompts. CoreMotion keeps no "refused just now", so a no read cold is "blocked": only Settings undoes it.
  static func status() -> String {
    switch CMMotionActivityManager.authorizationStatus() {
    case .authorized: return "granted"
    case .denied, .restricted: return "blocked"
    case .notDetermined: return "undetermined"
    @unknown default: return "undetermined"
    }
  }

  /// The system sheet, only after the app's own card's Continue. CoreMotion has no ask of its own: a query over
  /// the last hour is what makes iOS put the question up, and the answer comes back as the status afterwards.
  func ask(done: @escaping (String) -> Void) {
    guard CMMotionActivityManager.isActivityAvailable() else {
      done("blocked")
      return
    }
    var answered = false
    let now = Date()
    activity.queryActivityStarting(from: now.addingTimeInterval(-3600), to: now, to: answers) { _, _ in
      if answered { return }
      answered = true
      switch CMMotionActivityManager.authorizationStatus() {
      case .authorized: done("granted")
      case .notDetermined: done("undetermined")
      // Asked just now, so a no is "denied": the card says to type the steps in instead.
      default: done("denied")
      }
    }
  }

  // MARK: the daily summary

  /// One entry per local day in the window: `{ day, steps, spans: [{ kind, minutes }] }`. A day the phone has no
  /// history for is left out rather than sent as a zero. `offsetMin` is the minutes to ADD to UTC for the phone's
  /// own local time (India is 330), so the days line up with the ones JavaScript asked about.
  func days(fromMs: Double, toMs: Double, offsetMin: Double, done: @escaping ([[String: Any]], String?) -> Void) {
    guard CMPedometer.isStepCountingAvailable() else {
      done([], "unavailable")
      return
    }
    guard fromMs.isFinite, toMs.isFinite else {
      done([], nil)
      return
    }
    let zone = TimeZone(secondsFromGMT: Int((offsetMin.isFinite ? offsetMin : 0).rounded()) * 60) ?? TimeZone.current
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let naming = DateFormatter()
    naming.locale = Locale(identifier: "en_US_POSIX")
    naming.timeZone = zone
    naming.dateFormat = "yyyy-MM-dd"

    let now = Date()
    let from = Date(timeIntervalSince1970: fromMs / 1000)
    let to = min(Date(timeIntervalSince1970: toMs / 1000), now)
    guard to > from, fromMs > 0 else {
      done([], nil)
      return
    }

    var starts: [Date] = []
    var cursor = calendar.startOfDay(for: from)
    while cursor < to && starts.count < TulmiMotion.maxDays {
      starts.append(cursor)
      guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
      cursor = next
    }
    guard let windowStart = starts.first else {
      done([], nil)
      return
    }

    // Every answer below is written on this one queue, so nothing is counted twice.
    let adding = DispatchQueue(label: "space.tailzu.perms.motion.days")
    var steps: [Int: Int] = [:]
    var spans: [String: [(String, Int)]] = [:]
    let waiting = DispatchGroup()

    for (index, start) in starts.enumerated() {
      let end = min(calendar.date(byAdding: .day, value: 1, to: start) ?? to, to)
      guard end > start else { continue }
      waiting.enter()
      pedometer.queryPedometerData(from: start, to: end) { data, _ in
        adding.async {
          if let counted = data?.numberOfSteps.intValue { steps[index] = max(0, counted) }
          waiting.leave()
        }
      }
    }

    waiting.enter()
    activity.queryActivityStarting(from: windowStart, to: to, to: answers) { found, _ in
      adding.async {
        spans = TulmiMotion.stretches(found ?? [], windowEnd: to, naming: naming)
        waiting.leave()
      }
    }

    waiting.notify(queue: adding) {
      var out: [[String: Any]] = []
      for (index, start) in starts.enumerated() {
        let day = naming.string(from: start)
        let counted = steps[index]
        let mine = spans[day] ?? []
        // Nothing known about this day at all: the phone's history only goes back about a week.
        if counted == nil && mine.isEmpty { continue }
        let listed: [[String: Any]] = mine.prefix(TulmiMotion.maxSpans).map { ["kind": $0.0, "minutes": $0.1] }
        out.append(["day": day, "steps": counted ?? 0, "spans": listed])
      }
      done(out, nil)
    }
  }

  /// Walking, running and riding, run together into stretches and kept from ten minutes up, by the day each
  /// stretch began on. Each activity CoreMotion returns marks a CHANGE, so a stretch runs until the next one.
  private static func stretches(
    _ found: [CMMotionActivity], windowEnd: Date, naming: DateFormatter
  ) -> [String: [(String, Int)]] {
    var out: [String: [(String, Int)]] = [:]
    var runningKind: String?
    var runningFrom = windowEnd

    func close(_ at: Date) {
      guard let kind = runningKind else { return }
      runningKind = nil
      let minutes = Int((at.timeIntervalSince(runningFrom) / 60).rounded(.down))
      guard minutes >= TulmiMotion.minMinutes else { return }
      out[naming.string(from: runningFrom), default: []].append((kind, minutes))
    }

    for one in found {
      let kind = TulmiMotion.kind(one)
      if kind == runningKind { continue }
      close(one.startDate)
      if let kind = kind {
        runningKind = kind
        runningFrom = one.startDate
      }
    }
    close(windowEnd)

    var sorted: [String: [(String, Int)]] = [:]
    for (day, list) in out { sorted[day] = list.sorted { $0.1 > $1.1 } }
    return sorted
  }

  /// What a stretch is called, or nil when it is nothing this feature counts. A guess the phone is not sure of
  /// counts for nothing, and being in a car never appears in the daily summary.
  private static func kind(_ one: CMMotionActivity) -> String? {
    guard one.confidence == .medium || one.confidence == .high else { return nil }
    if one.cycling { return "cycle" }
    if one.running { return "run" }
    if one.walking { return "walk" }
    return nil
  }

  // MARK: the pre-ring check

  /// Whether the phone has been in a car in the last few minutes: true, false, or nil when it cannot say (no
  /// grant, no sensor, an error). Nothing about this is kept here.
  func driving(windowSec: Double, done: @escaping (Bool?) -> Void) {
    guard CMMotionActivityManager.isActivityAvailable(),
          CMMotionActivityManager.authorizationStatus() == .authorized else {
      done(nil)
      return
    }
    let wanted = windowSec.isFinite && windowSec > 0 ? windowSec : TulmiMotion.drivingWindow
    let window = min(wanted, TulmiMotion.maxDrivingWindow)
    var answered = false
    let now = Date()
    activity.queryActivityStarting(from: now.addingTimeInterval(-window), to: now, to: answers) { found, error in
      if answered { return }
      answered = true
      guard let found = found, error == nil else {
        done(nil)
        return
      }
      for one in found where one.automotive && (one.confidence == .medium || one.confidence == .high) {
        done(true)
        return
      }
      done(false)
    }
  }
}
