import SwiftUI
import WidgetKit

// FROM YOUR PEOPLE. The latest few things from family and friends, as the server worded them: "Riya shared Weekend plan",
// "Mom: Call Grandma · task", "Sam: running late". Each row says who, what and when; on a medium or large widget a tap on a row
// opens exactly that thing in the app (the row's own link); a small widget opens the newest one, or the server's page for them all.
// Nobody yet: the server's line inviting a space to be made, and its button.
//
// THE LOCK SCREEN NEVER SHOWS WHAT WAS SAID. Its rectangle has only the count line ("2 new from your people"); on the Home Screen a
// message's words are marked private, so a locked phone (StandBy, an Always-On display) shows them redacted.
//
// What it reads is QuickAccess.swift's (the app writes it from GET /v1/widgets/now); how many rows each size shows, every word,
// the colours and each kind's symbol are the server's, each with today's value as its fallback.

struct PeopleWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: QuickKeys.peopleKind, provider: NowProvider()) { entry in
      PeopleView(entry: entry)
    }
    // Gallery metadata, read before the app has ever run: compile-time literals.
    .configurationDisplayName("From your people")
    .description("The latest from family and friends.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
  }
}

struct PeopleView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  let entry: NowEntry

  private var section: NowSection { entry.doc?.people ?? NowSection() }
  private var ink: QuickInk { QuickInk(look: entry.doc?.look ?? NowLook(), scheme: scheme) }
  private var time: String { entry.doc?.time ?? "relative" }
  private var showing: Bool { entry.doc != nil && section.on && !section.rows.isEmpty }

  private var rowCount: Int {
    switch family {
    case .systemSmall: return section.limit("small", 2)
    case .systemLarge: return section.limit("large", 6)
    default: return section.limit("medium", 3)
    }
  }

  /// Where a tap that is not on a row goes: the only row, the server's page for them all, or (nobody yet) making a space.
  private var tapURL: URL? {
    let fallback = URL(string: "tulmi://screen/bots.spaces")
    guard showing else { return section.emptyURL ?? fallback }
    if family == .systemSmall, rowCount == 1 || section.rows.count == 1, let first = section.rows.first?.url { return first }
    return section.url ?? section.rows.first?.url ?? fallback
  }

  var body: some View {
    Group {
      if family == .accessoryRectangular { lock } else { home }
    }
    .containerBackground(ink.ground, for: .widget)
    .widgetURL(tapURL)
  }

  private var home: some View {
    VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 9) {
      QuickHeader(section: section, fallbackTitle: "From your people", fallbackIcon: "person.2.fill", ink: ink)
      if showing {
        ForEach(Array(section.rows.prefix(max(1, rowCount)))) { row in
          if family == .systemSmall {
            PersonRow(row: row, ink: ink, time: time, compact: true)
          } else if let url = row.url {
            Link(destination: url) { PersonRow(row: row, ink: ink, time: time, compact: false) }
          } else {
            PersonRow(row: row, ink: ink, time: time, compact: false)
          }
        }
        Spacer(minLength: 0)
      } else {
        QuickEmpty(
          section: section, ink: ink, compact: family == .systemSmall,
          fallbackTitle: "Your people, here", fallbackBody: "Make a space for family and friends.", fallbackCta: "Make a space")
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// The Lock Screen: the title and the count line. Never a name, never a word anyone said.
  private var lock: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Image(systemName: symbol(section.icon, "person.2.fill"))
        Text(section.title.isEmpty ? "From your people" : section.title).lineLimit(1)
      }
      .font(.system(size: 12, weight: .semibold))
      .widgetAccentable()
      Text(section.lockLine.isEmpty ? "Open X0 Bot" : section.lockLine)
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .lineLimit(2)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One thing from one person: their mark, who, when, and what (a message's words marked private).
struct PersonRow: View {
  let row: NowRow
  let ink: QuickInk
  let time: String
  let compact: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      KindMark(row: row, ink: ink).padding(.top, 1)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 4) {
          Text(row.who)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(ink.pale)
            .lineLimit(1)
          if !row.tag.isEmpty {
            Text(row.tag)
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(ink.dim)
              .lineLimit(1)
          }
          Spacer(minLength: 4)
          if !compact {
            WhenText(row: row, style: time)
              .font(.system(size: 10))
              .monospacedDigit()
              .foregroundStyle(ink.dim)
              .lineLimit(1)
          }
        }
        Text(row.text.isEmpty ? row.line : row.text)
          .font(.system(size: 12))
          .foregroundStyle(ink.pale.opacity(0.86))
          .lineLimit(compact ? 1 : 2)
          .privacySensitive(row.isPrivate)
      }
    }
  }
}
