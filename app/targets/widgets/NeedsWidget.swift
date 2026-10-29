import AppIntents
import SwiftUI
import WidgetKit

// NEEDS YOU, WITH ITS BUTTONS (iOS 17 interactive widget). A bot's question with its answers ("Move dinner to 7:30?" Yes / No),
// a yes a connected app waits for, a task someone gave you with Done. Tapping the words opens that thing in the app.
//
// Which buttons a kind of row has, their words, order and style, and whether each answers right here (AnswerNeedIntent, with the
// widgets' own narrow token: QuickAccess.swift) or opens the app, are the server's, per kind; so is everything else drawn. A
// pressed button's row says how it went ("Done", "Already answered", "Open X0 Bot to finish") until the app next writes the rows.
// The Lock Screen's rectangle has only the count line.

struct NeedsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: QuickKeys.needsKind, provider: NowProvider()) { entry in
      NeedsView(entry: entry)
    }
    // Gallery metadata, read before the app has ever run: compile-time literals.
    .configurationDisplayName("Needs you")
    .description("Answer your bots and tick off tasks without opening the app.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
  }
}

struct NeedsView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  let entry: NowEntry

  private var section: NowSection { entry.doc?.needs ?? NowSection() }
  private var ink: QuickInk { QuickInk(look: entry.doc?.look ?? NowLook(), scheme: scheme) }
  private var time: String { entry.doc?.time ?? "relative" }
  private var showing: Bool { entry.doc != nil && section.on && !section.rows.isEmpty }

  private var rowCount: Int {
    switch family {
    case .systemSmall: return section.limit("small", 1)
    case .systemLarge: return section.limit("large", 4)
    default: return section.limit("medium", 2)
    }
  }

  private var rows: [NowRow] { Array(section.rows.prefix(max(1, rowCount))) }

  /// A tap off the buttons: the first row on a small widget (its words fill it), else the server's page for them all.
  private var tapURL: URL? {
    let fallback = URL(string: "tulmi://screen/bots.home")
    guard showing else { return section.emptyURL ?? fallback }
    if family == .systemSmall, let first = rows.first?.url { return first }
    return section.url ?? rows.first?.url ?? fallback
  }

  var body: some View {
    Group {
      if family == .accessoryRectangular { lock } else { home }
    }
    .containerBackground(ink.ground, for: .widget)
    .widgetURL(tapURL)
  }

  private var home: some View {
    VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 10) {
      QuickHeader(section: section, fallbackTitle: "Needs you", fallbackIcon: "exclamationmark.bubble", ink: ink)
      if showing {
        ForEach(rows) { row in
          NeedRow(row: row, state: entry.states[row.id], section: section, ink: ink, time: time, compact: family == .systemSmall)
          if family != .systemSmall && row.id != rows.last?.id {
            Rectangle().fill(ink.rule).frame(height: 1)
          }
        }
        Spacer(minLength: 0)
      } else {
        QuickEmpty(
          section: section, ink: ink, compact: family == .systemSmall,
          fallbackTitle: "All clear", fallbackBody: "Nothing needs you right now.", fallbackCta: "")
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// The Lock Screen: the title and how many. Never what is asked.
  private var lock: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Image(systemName: symbol(section.icon, "exclamationmark.bubble"))
        Text(section.title.isEmpty ? "Needs you" : section.title).lineLimit(1)
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

/// One thing that needs the person: who, what, and its buttons, or how a pressed one went.
struct NeedRow: View {
  let row: NowRow
  let state: RowState?
  let section: NowSection
  let ink: QuickInk
  let time: String
  let compact: Bool

  /// A small widget has no links: only the buttons that answer right here.
  private var buttons: [NowAction] { Array(row.actions.filter { $0.inPlace || !compact }.prefix(compact ? 2 : 3)) }

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 6 : 7) {
      if !compact, let url = row.url {
        Link(destination: url) { words }
      } else {
        words
      }
      if let state {
        outcome(state)
      } else if !buttons.isEmpty {
        HStack(spacing: 6) {
          ForEach(buttons) { a in button(a) }
          Spacer(minLength: 0)
        }
      }
    }
  }

  private var words: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 6) {
        KindMark(row: row, ink: ink)
        Text(row.who)
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(ink.dim)
          .lineLimit(1)
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
        .font(.system(size: compact ? 13 : 14, weight: .medium))
        .foregroundStyle(ink.pale)
        .lineLimit(compact ? 3 : 2)
        .privacySensitive(row.isPrivate)
      if !compact && !row.detail.isEmpty {
        Text(row.detail)
          .font(.system(size: 11))
          .foregroundStyle(ink.dim)
          .lineLimit(1)
          .privacySensitive(row.isPrivate)
      }
    }
  }

  private func pill(_ a: NowAction) -> some View {
    HStack(spacing: 4) {
      if let icon = a.icon {
        Image(systemName: symbol(icon, "checkmark")).font(.system(size: 11, weight: .bold))
      }
      Text(a.label).lineLimit(1)
    }
    .font(.system(size: 12, weight: .semibold))
    .foregroundStyle(ink.fg(a.style))
    .padding(.horizontal, compact ? 10 : 12)
    .frame(height: 28)
    .background(ink.bg(a.style), in: Capsule())
  }

  @ViewBuilder
  private func button(_ a: NowAction) -> some View {
    if a.inPlace {
      Button(intent: AnswerNeedIntent(item: row.id, action: a.id)) { pill(a) }
        .buttonStyle(.plain)
    } else if let url = a.url {
      Link(destination: url) { pill(a) }
    }
  }

  @ViewBuilder
  private func outcome(_ s: RowState) -> some View {
    switch s {
    case .done:
      Label(section.word("done", "Done"), systemImage: "checkmark.circle.fill")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(ink.accent)
    case .gone:
      Label(section.word("gone", "Already answered"), systemImage: "checkmark.circle")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(ink.dim)
    case .failed:
      Label(section.word("failed", "Open X0 Bot to finish"), systemImage: "arrow.up.forward.app")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(ink.dim)
    }
  }
}
