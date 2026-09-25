import SwiftUI
import WidgetKit

// THE MONTH. The one number that decides whether the app keeps working, and
// the only one that goes up on its own. For the free plan it is the words
// left, with the line as far along as the month is spent; for a subscriber
// there is no such number, so it is the words this month and a line that
// fills very slowly — the same rule as the stats screen.

struct MonthStats: Codable {
  var used: Int = 0
  var total: Int = 0
  var remaining: Int = 0
  var earned: Int = 0
  var base: Int = 0
  var streak: Int = 0
  var entitled: Bool = false
  var updatedAt: Double = 0

  /// A subscriber's line: the month against a span no month reaches.
  static let paidSpan = 120_000

  var fraction: Double {
    if entitled { return min(1, Double(max(0, used)) / Double(MonthStats.paidSpan)) }
    guard total > 0 else { return 0 }
    return min(1, Double(max(0, used)) / Double(total))
  }
  var headline: Int { entitled ? used : remaining }
  var label: String { entitled ? "THIS MONTH" : "WORDS LEFT" }

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
    // timeline only has to survive between those, so it asks again in an hour.
    let entry = MonthEntry(date: Date(), month: MonthStats.load())
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
  }
}

struct MonthWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "space.tailzu.month", provider: MonthProvider()) { entry in
      MonthView(entry: entry)
        .containerBackground(Ink.ground, for: .widget)
        .widgetURL(URL(string: "tulmi://screen/stats"))
    }
    .configurationDisplayName("The Month")
    .description("Words this month, and your streak.")
    .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct MonthView: View {
  @Environment(\.widgetFamily) private var family
  let entry: MonthEntry

  var body: some View {
    switch family {
    case .accessoryCircular: circular
    case .accessoryRectangular: rectangular
    case .accessoryInline: inline
    default: small
    }
  }

  /// Nothing written yet, or a phone that has not signed in: the mark alone.
  private var empty: some View {
    VStack(spacing: 8) {
      WaveMark().frame(width: 44, height: 30)
      Text("TAILZU").font(.system(size: 9, weight: .semibold)).tracking(1.8).foregroundStyle(Ink.dim)
    }
  }

  private var small: some View {
    Group {
      if let m = entry.month {
        VStack(alignment: .leading, spacing: 0) {
          HStack(alignment: .top) {
            WaveMark().frame(width: 30, height: 20)
            Spacer()
            if m.streak > 0 {
              Text("\(m.streak)d")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(Ink.amber)
            }
          }
          Spacer(minLength: 6)
          Text(n(m.headline))
            .font(.system(size: 30, weight: .heavy, design: .rounded))
            .foregroundStyle(Ink.pale)
            .minimumScaleFactor(0.6)
            .lineLimit(1)
          Text(m.label)
            .font(.system(size: 8, weight: .semibold))
            .tracking(1.6)
            .foregroundStyle(Ink.dim)
            .padding(.top, 1)
          Line(fraction: m.fraction).frame(height: 5).padding(.top, 8)
        }
      } else {
        empty
      }
    }
  }

  private var circular: some View {
    Group {
      if let m = entry.month {
        Gauge(value: m.entitled ? m.fraction : 1 - m.fraction) {
          Text("words")
        } currentValueLabel: {
          Text(short(m.headline)).font(.system(size: 14, weight: .bold, design: .rounded))
        }
        .gaugeStyle(.accessoryCircular)
      } else {
        WaveMark(color: .primary).frame(width: 34, height: 22)
      }
    }
  }

  private var rectangular: some View {
    Group {
      if let m = entry.month {
        VStack(alignment: .leading, spacing: 3) {
          HStack(spacing: 6) {
            WaveMark(color: .primary).frame(width: 18, height: 12)
            Text(m.entitled ? "Words this month" : "Words left").font(.system(size: 12, weight: .semibold))
          }
          Text(n(m.headline)).font(.system(size: 22, weight: .heavy, design: .rounded))
          Line(fraction: m.fraction, tint: .primary).frame(height: 4)
          if m.streak > 0 {
            Text("\(m.streak)-day streak").font(.system(size: 11)).foregroundStyle(.secondary)
          }
        }
      } else {
        HStack(spacing: 6) {
          WaveMark(color: .primary).frame(width: 18, height: 12)
          Text("Tailzu").font(.system(size: 12, weight: .semibold))
        }
      }
    }
  }

  private var inline: some View {
    Group {
      if let m = entry.month {
        if m.entitled {
          Text("Tailzu · \(n(m.used)) words" + (m.streak > 0 ? " · \(m.streak)d" : ""))
        } else {
          Text("Tailzu · \(n(m.remaining)) left" + (m.streak > 0 ? " · \(m.streak)d" : ""))
        }
      } else {
        Text("Tailzu")
      }
    }
  }

  /// "4.8k" where a gauge has no room for "4,820".
  private func short(_ v: Int) -> String {
    v >= 10_000 ? "\(v / 1000)k" : v >= 1000 ? String(format: "%.1fk", Double(v) / 1000) : String(v)
  }
}

/// The line: the month, as far along as it is.
struct Line: View {
  let fraction: Double
  var tint: Color = Ink.amber
  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(tint.opacity(0.14))
        Capsule().fill(tint).frame(width: max(0, min(1, fraction)) * geo.size.width)
      }
    }
  }
}
