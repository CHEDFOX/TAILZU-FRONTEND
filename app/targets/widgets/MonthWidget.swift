import SwiftUI
import WidgetKit

// THE MONTH. The one number that decides whether the app keeps working, and
// the only one that goes up on its own. For the free plan it is the words
// left, with the line as far along as the month is spent; for a subscriber
// there is no such number, so it is the words this month and a line that
// fills very slowly — the same rule as the stats screen.
//
// The app now writes the headline and the line's fill itself, along with the
// words, tap target, refresh interval, subscriber span and whether the streak
// shows (see WidgetLook in TailzuWidgets.swift). The rule below is kept only
// for JSON an older app wrote, which has none of that. The look is the app's:
// the mark, the number in ink, the line in ink on the line colour, on the
// palette's ground in Light and Dark (X0Palette).

struct MonthStats: Codable {
  var used: Int = 0
  var total: Int = 0
  var remaining: Int = 0
  var earned: Int = 0
  var base: Int = 0
  var streak: Int = 0
  var entitled: Bool = false
  var updatedAt: Double = 0
  /// The headline number and the line's fill, as the app worked them out.
  /// Absent from what an older app wrote; then they are worked out here.
  var sentHeadline: Double? = nil
  var sentFraction: Double? = nil

  enum CodingKeys: String, CodingKey {
    case used, total, remaining, earned, base, streak, entitled, updatedAt
    case sentHeadline = "headline"
    case sentFraction = "fraction"
  }

  /// A subscriber's line: the month against a span no month reaches — the
  /// server's (widget.month.paidSpan), or this.
  static let paidSpan = 120_000

  var fraction: Double {
    if let f = sentFraction, f.isFinite { return min(1, max(0, f)) }
    if entitled {
      let span = WidgetLook.current.span.flatMap { $0 > 0 ? $0 : nil } ?? Double(MonthStats.paidSpan)
      return min(1, Double(max(0, used)) / span)
    }
    guard total > 0 else { return 0 }
    return min(1, Double(max(0, used)) / Double(total))
  }
  var headline: Int {
    if let h = sentHeadline, h.isFinite, abs(h) < 1e15 { return Int(h.rounded()) }
    return entitled ? used : remaining
  }
  var label: String {
    let look = WidgetLook.current
    return entitled ? look.text("thisMonth", "THIS MONTH") : look.text("wordsLeft", "WORDS LEFT")
  }

  /// What the app last wrote to the App Group, or nothing.
  static func load() -> MonthStats? {
    guard let raw = Shared.store?.string(forKey: "tulmi.widget.month"),
          let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(MonthStats.self, from: data)
  }

  static let sample = MonthStats(used: 742, total: 1060, remaining: 318, earned: 260, base: 800, streak: 5)
}

struct MonthEntry: TimelineEntry {
  let date: Date
  let month: MonthStats?
}

struct MonthProvider: TimelineProvider {
  func placeholder(in context: Context) -> MonthEntry { MonthEntry(date: Date(), month: .sample) }
  func getSnapshot(in context: Context, completion: @escaping (MonthEntry) -> Void) {
    completion(MonthEntry(date: Date(), month: MonthStats.load() ?? .sample))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<MonthEntry>) -> Void) {
    // The app reloads the widget whenever it fetches fresh numbers; this
    // timeline only has to survive between those, so it asks again after the
    // server's interval (an hour until the app has written one).
    let entry = MonthEntry(date: Date(), month: MonthStats.load())
    let next = Date().addingTimeInterval(WidgetLook.current.refreshInterval)
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

struct MonthWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "space.tailzu.month", provider: MonthProvider()) { entry in
      MonthView(entry: entry)
        .widgetURL(WidgetLook.current.tapURL)
    }
    .configurationDisplayName(WidgetLook.current.text("displayName", "The Month"))
    .description(WidgetLook.current.text("description", "Words this month."))
    .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct MonthView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  let entry: MonthEntry
  /// The words the app last wrote (cached per change, so cheap to ask for).
  private var look: WidgetLook { WidgetLook.current }
  private var p: X0Palette { X0Palette.of(scheme) }

  /// The Home Screen's card is the palette's ground; the Lock Screen's
  /// accessories have none of their own (the system tints them).
  private var isAccessory: Bool {
    family == .accessoryCircular || family == .accessoryRectangular || family == .accessoryInline
  }

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular: circular
      case .accessoryRectangular: rectangular
      case .accessoryInline: inline
      default: small
      }
    }
    .containerBackground(isAccessory ? Color.clear : p.ground, for: .widget)
  }

  /// Nothing written yet, or a phone that has not signed in: the mark and the
  /// name.
  private var signedOut: some View {
    VStack(spacing: 10) {
      X0Mark(size: 48, onDark: p.onDark)
      Text(x0Name)
        .font(.system(size: 17, weight: .semibold))
        .tracking(-0.3)
        .foregroundStyle(p.ink)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  /// The mark, the number, what it counts, and the line. Nothing else unless
  /// the server turns the streak on.
  private var small: some View {
    Group {
      if let m = entry.month {
        VStack(alignment: .leading, spacing: 0) {
          X0Mark(size: 22, onDark: p.onDark)
          Spacer(minLength: 0)
          Text(n(m.headline))
            .font(.system(size: 34, weight: .semibold))
            .tracking(-0.4)
            .monospacedDigit()
            .foregroundStyle(p.ink)
            .minimumScaleFactor(0.5)
            .lineLimit(1)
          Text(m.label)
            .font(.system(size: 11, weight: .medium))
            .tracking(0.4)
            .foregroundStyle(p.meta)
            .lineLimit(1)
            .padding(.top, 2)
          if look.showStreak && m.streak > 0 {
            Text(look.text("streakShort", "{n}d", n: String(m.streak)))
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(p.meta)
              .padding(.top, 2)
          }
          if look.showProgress {
            Line(fraction: m.fraction, fill: p.ink, track: p.line).frame(height: 4).padding(.top, 12)
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      } else {
        signedOut
      }
    }
  }

  private var circular: some View {
    Group {
      if let m = entry.month {
        Gauge(value: m.entitled ? m.fraction : 1 - m.fraction) {
          Text(look.text("gaugeWords", "words"))
        } currentValueLabel: {
          Text(short(m.headline)).font(.system(size: 14, weight: .semibold))
        }
        .gaugeStyle(.accessoryCircular)
      } else {
        // On its white tile, the bot reads through the Lock Screen's tint.
        X0Mark(size: 40, onDark: true)
      }
    }
  }

  private var rectangular: some View {
    Group {
      if let m = entry.month {
        VStack(alignment: .leading, spacing: 2) {
          Text(m.entitled
               ? look.text("wordsThisMonth", "Words this month")
               : look.text("wordsLeftTitle", "Words left"))
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
          Text(n(m.headline))
            .font(.system(size: 22, weight: .semibold))
            .tracking(-0.3)
            .monospacedDigit()
          if look.showProgress {
            Line(fraction: m.fraction, fill: .primary, track: Color.primary.opacity(0.25))
              .frame(height: 3)
              .padding(.top, 2)
          }
          if look.showStreak && m.streak > 0 {
            Text(look.text("streakLong", "{n}-day streak", n: String(m.streak)))
              .font(.system(size: 11)).foregroundStyle(.secondary)
          }
        }
      } else {
        HStack(spacing: 8) {
          X0Mark(size: 26, onDark: true)
          Text(x0Name).font(.system(size: 15, weight: .semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private var inline: some View {
    Group {
      if let m = entry.month {
        let streak = look.showStreak && m.streak > 0 ? look.text("inlineStreak", " · {n}d", n: String(m.streak)) : ""
        if m.entitled {
          Text(look.text("inlinePaid", "X0 · {n} words", n: n(m.used)) + streak)
        } else {
          Text(look.text("inlineFree", "X0 · {n} left", n: n(m.remaining)) + streak)
        }
      } else {
        Text(x0Name)
      }
    }
  }

  /// "4.8k" where a gauge has no room for "4,820".
  private func short(_ v: Int) -> String {
    v >= 10_000 ? "\(v / 1000)k" : v >= 1000 ? String(format: "%.1fk", Double(v) / 1000) : String(v)
  }
}

/// The line: the month, as far along as it is. Ink on the line colour.
struct Line: View {
  let fraction: Double
  let fill: Color
  let track: Color
  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(track)
        Capsule().fill(fill).frame(width: max(0, min(1, fraction)) * geo.size.width)
      }
    }
  }
}
