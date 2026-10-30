import SwiftUI
import WidgetKit

// FROM YOUR PEOPLE. The latest few things from family and friends, as the server worded them: "Riya shared Weekend plan",
// "Mom: Call Grandma · task", "Sam: running late". Each row is who (their initial on a grey disc), the whole line the server
// wrote (never only its title: "shared" is part of what happened), and under it the tag, the space and when; on a medium or
// large widget a tap on a row opens exactly that thing in the app (the row's own link); a small widget opens the newest one, or
// the server's page for them all. Nobody yet: the server's line inviting a space to be made, and its button.
//
// THE LOCK SCREEN NEVER SHOWS WHAT WAS SAID. Its rectangle has only the count line ("2 new from your people"); on the Home Screen a
// message's words are marked private, so a locked phone (StandBy, an Always-On display) shows them redacted.
//
// What it reads is QuickAccess.swift's (the app writes it from GET /v1/widgets/now); how many rows each size shows (at most) and
// every word are the server's, each with today's value as its fallback. How many are drawn is what fits, whole (ViewThatFits).

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
  private var p: X0Palette { X0Palette.of(scheme) }
  private var time: String { entry.doc?.time ?? "relative" }
  private var showing: Bool { entry.doc != nil && section.on && !section.rows.isEmpty }
  private var title: String { section.title.isEmpty ? "From your people" : section.title }

  /// The most rows a size may show: the server's number.
  private var cap: Int {
    switch family {
    case .systemSmall: return max(1, section.limit("small", 2))
    case .systemLarge: return max(1, section.limit("large", 6))
    default: return max(1, section.limit("medium", 3))
    }
  }

  /// Where a tap that is not on a row goes: the only row, the server's page for them all, or (nobody yet) making a space.
  private var tapURL: URL? {
    let fallback = URL(string: "tulmi://screen/bots.spaces")
    guard showing else { return section.emptyURL ?? fallback }
    if family == .systemSmall, cap == 1 || section.rows.count == 1, let first = section.rows.first?.url { return first }
    return section.url ?? section.rows.first?.url ?? fallback
  }

  var body: some View {
    Group {
      if family == .accessoryRectangular { lock } else { home }
    }
    .containerBackground(family == .accessoryRectangular ? Color.clear : p.ground, for: .widget)
    .widgetURL(tapURL)
  }

  private var home: some View {
    VStack(alignment: .leading, spacing: family == .systemSmall ? 10 : 12) {
      QuickHeader(title: title, p: p)
      if showing {
        list.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      } else {
        QuickEmpty(
          section: section, p: p, compact: family == .systemSmall,
          fallbackTitle: "Your people, here", fallbackBody: "Make a space for family and friends.", fallbackCta: "Make a space")
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// As many rows as fit, whole (each line on two lines when there is room): the first of these that fits is drawn.
  private var list: some View {
    ViewThatFits(in: .vertical) {
      rows(6, lines: 2)
      rows(6, lines: 1)
      rows(5, lines: 1)
      rows(4, lines: 1)
      rows(3, lines: 2)
      rows(3, lines: 1)
      rows(2, lines: 2)
      rows(2, lines: 1)
      rows(1, lines: 2)
      rows(1, lines: 1)
    }
  }

  private func rows(_ count: Int, lines: Int) -> some View {
    let shown = Array(section.rows.prefix(max(1, min(count, cap))))
    let compact = family == .systemSmall
    return VStack(alignment: .leading, spacing: compact ? 10 : 8) {
      ForEach(shown) { row in
        if compact {
          PersonRow(row: row, p: p, time: time, now: entry.date, lines: lines, compact: true)
        } else if let url = row.url {
          Link(destination: url) { PersonRow(row: row, p: p, time: time, now: entry.date, lines: lines, compact: false) }
        } else {
          PersonRow(row: row, p: p, time: time, now: entry.date, lines: lines, compact: false)
        }
        if !compact && row.id != shown.last?.id {
          Hairline(p: p)
        }
      }
    }
  }

  /// The Lock Screen: the title and the count line. Never a name, never a word anyone said.
  private var lock: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Image(systemName: symbol(section.icon, "person.2.fill"))
        Text(title).lineLimit(1)
      }
      .font(.system(size: 12, weight: .semibold))
      .widgetAccentable()
      Text(section.lockLine.isEmpty ? "Open X0" : section.lockLine)
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .lineLimit(2)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One thing from one person: their initial, the server's whole line ("Riya shared Weekend plan"; a message's words marked
/// private), and under it the tag, the space and when.
struct PersonRow: View {
  let row: NowRow
  let p: X0Palette
  let time: String
  let now: Date
  let lines: Int
  let compact: Bool

  /// "task · Family · 4 min ago", or as much of it as the row has.
  private var meta: Text? {
    // A tag the line already says ("Riya shared Weekend plan" · shared) would only say it again.
    let tag = !row.tag.isEmpty && row.line.localizedCaseInsensitiveContains(row.tag) ? "" : row.tag
    var parts = [tag, row.detail].filter { !$0.isEmpty }.map { Text($0) }
    if hasWhen(row, style: time) { parts.append(whenText(row, style: time, now: now)) }
    guard var out = parts.first else { return nil }
    for part in parts.dropFirst() { out = out + Text("  ·  ") + part }
    return out
  }

  var body: some View {
    HStack(alignment: .top, spacing: compact ? 8 : 10) {
      RowAvatar(row: row, p: p, size: compact ? 20 : 26)
      VStack(alignment: .leading, spacing: 2) {
        Text(row.sentence)
          .font(.system(size: compact ? 12 : 13, weight: .medium))
          .tracking(-0.1)
          .foregroundStyle(p.ink)
          .lineLimit(lines)
          .fixedSize(horizontal: false, vertical: true)
          .privacySensitive(row.isPrivate)
        if !compact, let line = meta {
          line
            .font(.system(size: 11))
            .foregroundStyle(p.meta)
            .lineLimit(1)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}
