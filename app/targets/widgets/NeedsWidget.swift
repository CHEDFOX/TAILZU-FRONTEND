import AppIntents
import SwiftUI
import WidgetKit

// NEEDS YOU, WITH ITS BUTTONS (iOS 17 interactive widget). A bot's question with its answers ("Move dinner to 7:30?" Yes / No),
// a yes a connected app waits for, a task someone gave you with Done. Tapping the words opens that thing in the app.
//
// Which buttons a kind of row has, their words, order and which is primary, and whether each answers right here
// (AnswerNeedIntent, with the widgets' own narrow token: QuickAccess.swift) or opens the app, are the server's, per kind; so is
// every word drawn. A pressed button's row says how it went ("Done", "Already answered", "Open X0 to finish") until the app next
// writes the rows. The Lock Screen's rectangle has only the count line.
//
// WHAT FITS IS DRAWN WHOLE. A row is who asks (their avatar, a bot's in its own colour), the question, and its buttons as pills
// that never truncate. How many rows a size shows is the server's number at most (needs.limits), and then only as many as fit
// (ViewThatFits): a medium widget (338 x 158 pt on a 390 pt phone, 16 pt margins) has room for one row and its buttons, a large
// one (338 x 354) for up to three. A small one shows the first row: who, the question, its answers stacked full width — or,
// when an answer's words would not fit, one Answer button, and the whole widget opens the row.

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
  private var p: X0Palette { X0Palette.of(scheme) }
  private var time: String { entry.doc?.time ?? "relative" }
  private var showing: Bool { entry.doc != nil && section.on && !section.rows.isEmpty }
  private var title: String { section.title.isEmpty ? "Needs you" : section.title }

  /// The most rows a size may show: the server's number, and never more than three (all a large widget fits with buttons).
  private var cap: Int {
    switch family {
    case .systemSmall: return 1
    case .systemLarge: return min(3, max(1, section.limit("large", 3)))
    default: return min(3, max(1, section.limit("medium", 2)))
    }
  }

  /// A tap off the buttons: the first row on a small widget (it fills it), else the server's page for them all.
  private var tapURL: URL? {
    let fallback = URL(string: "tulmi://screen/bots.home")
    guard showing else { return section.emptyURL ?? fallback }
    if family == .systemSmall, let first = section.rows.first?.url { return first }
    return section.url ?? section.rows.first?.url ?? fallback
  }

  var body: some View {
    Group {
      if family == .accessoryRectangular { lock } else { home }
    }
    .containerBackground(family == .accessoryRectangular ? Color.clear : p.ground, for: .widget)
    .widgetURL(tapURL)
  }

  @ViewBuilder
  private var home: some View {
    if showing, family == .systemSmall, let row = section.rows.first {
      NeedSmall(row: row, state: entry.states[row.id], section: section, p: p)
    } else {
      VStack(alignment: .leading, spacing: 12) {
        QuickHeader(title: title, count: showing && section.rows.count > 1 ? section.rows.count : nil, p: p)
        if showing {
          list.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
          QuickEmpty(
            section: section, p: p, compact: family == .systemSmall,
            fallbackTitle: "All clear", fallbackBody: "Nothing needs you right now.", fallbackCta: "")
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  /// As many rows as fit, whole: the first of these that fits the widget is drawn.
  private var list: some View {
    ViewThatFits(in: .vertical) {
      rows(3, lines: 2, detail: true)
      rows(3, lines: 2, detail: false)
      rows(3, lines: 1, detail: false)
      rows(2, lines: 2, detail: true)
      rows(2, lines: 2, detail: false)
      rows(2, lines: 1, detail: false)
      rows(1, lines: 2, detail: true)
      rows(1, lines: 2, detail: false)
      rows(1, lines: 1, detail: false)
    }
  }

  private func rows(_ count: Int, lines: Int, detail: Bool) -> some View {
    let shown = Array(section.rows.prefix(max(1, min(count, cap))))
    return VStack(alignment: .leading, spacing: 12) {
      ForEach(shown) { row in
        NeedRow(row: row, state: entry.states[row.id], section: section, p: p, time: time, now: entry.date, lines: lines,
                detail: detail)
        if row.id != shown.last?.id {
          Hairline(p: p)
        }
      }
    }
  }

  /// The Lock Screen: the title and how many. Never what is asked.
  private var lock: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Image(systemName: symbol(section.icon, "exclamationmark.bubble"))
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

/// One thing that needs the person, on a medium or large widget: who asks and when, the question, and its buttons (or how a
/// pressed one went). The words open the row.
struct NeedRow: View {
  let row: NowRow
  let state: RowState?
  let section: NowSection
  let p: X0Palette
  let time: String
  let now: Date
  let lines: Int
  let detail: Bool

  private var buttons: [NowAction] { Array(row.actions.prefix(3)) }

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      RowAvatar(row: row, p: p, size: 26)
      VStack(alignment: .leading, spacing: 8) {
        if let url = row.url {
          Link(destination: url) { words }
        } else {
          words
        }
        if let state {
          NeedOutcome(state: state, section: section, p: p)
        } else if !buttons.isEmpty {
          answers
        }
      }
    }
  }

  private var words: some View {
    VStack(alignment: .leading, spacing: 2) {
      whoLine
        .font(.system(size: 12))
        .foregroundStyle(p.meta)
        .lineLimit(1)
      Text(row.ask)
        .font(.system(size: 15, weight: .semibold))
        .tracking(-0.2)
        .foregroundStyle(p.ink)
        .lineLimit(lines)
        .fixedSize(horizontal: false, vertical: true)
        .privacySensitive(row.isPrivate)
      if detail && !row.detail.isEmpty {
        Text(row.detail)
          .font(.system(size: 12))
          .foregroundStyle(p.meta)
          .lineLimit(1)
          .privacySensitive(row.isPrivate)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// "Plan bot · 4 min ago": who in ink, when in grey.
  private var whoLine: Text {
    let who = Text(row.who).fontWeight(.semibold).foregroundColor(p.ink)
    guard hasWhen(row, style: time) else { return who }
    return who + Text("  ·  ") + whenText(row, style: time, now: now)
  }

  /// The buttons in a row as they are; when their words would not fit, one Answer button that opens the row.
  private var answers: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 8) {
        ForEach(buttons) { a in NeedButton(row: row, action: a, p: p) }
      }
      if let url = row.url {
        Link(destination: url) { X0Pill(label: section.word("answer", "Answer"), primary: true, p: p) }
      }
    }
  }
}

/// The first thing that needs the person, filling a small widget: who, the question, and its answers stacked full width — or one
/// Answer button when they would not fit, and a tap anywhere opens the row (a small widget has no links of its own).
struct NeedSmall: View {
  let row: NowRow
  let state: RowState?
  let section: NowSection
  let p: X0Palette

  /// Only the buttons that answer right here, two at most.
  private var inPlace: [NowAction] { Array(row.actions.filter { $0.inPlace }.prefix(2)) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 6) {
        RowAvatar(row: row, p: p, size: 18)
        Text(row.who)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(p.meta)
          .lineLimit(1)
        Spacer(minLength: 0)
      }
      Text(row.ask)
        .font(.system(size: 14, weight: .semibold))
        .tracking(-0.2)
        .foregroundStyle(p.ink)
        .lineLimit(3)
        .privacySensitive(row.isPrivate)
        .padding(.top, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      answers.padding(.top, 6)
    }
  }

  @ViewBuilder
  private var answers: some View {
    if let state {
      NeedOutcome(state: state, section: section, p: p)
    } else if inPlace.isEmpty {
      answerPill
    } else {
      ViewThatFits(in: .horizontal) {
        VStack(spacing: 4) {
          ForEach(inPlace) { a in NeedButton(row: row, action: a, p: p, fill: true, height: 26) }
        }
        answerPill
      }
    }
  }

  /// Not a button of its own: the whole widget opens the row.
  private var answerPill: some View {
    X0Pill(label: section.word("answer", "Answer"), primary: true, p: p, fill: true, height: 28)
  }
}

/// One of a row's buttons: answered right here with the widgets' token, or a link into the app. The server's primary is filled
/// with ink; every other style is the bordered secondary.
struct NeedButton: View {
  let row: NowRow
  let action: NowAction
  let p: X0Palette
  var fill = false
  var height: CGFloat = 30

  private var pill: X0Pill {
    X0Pill(label: action.label, icon: action.icon, primary: action.style == "primary", p: p, fill: fill, height: height)
  }

  var body: some View {
    if action.inPlace {
      Button(intent: AnswerNeedIntent(item: row.id, action: action.id)) { pill }
        .buttonStyle(.plain)
    } else if let url = action.url {
      Link(destination: url) { pill }
    }
  }
}

/// How a pressed button went, where its buttons were, until the app next writes the rows.
struct NeedOutcome: View {
  let state: RowState
  let section: NowSection
  let p: X0Palette

  private var word: String {
    switch state {
    case .done: return section.word("done", "Done")
    case .gone: return section.word("gone", "Already answered")
    case .failed: return section.word("failed", "Open X0 to finish")
    }
  }

  private var icon: String {
    switch state {
    case .done: return "checkmark.circle.fill"
    case .gone: return "checkmark.circle"
    case .failed: return "arrow.up.forward.app"
    }
  }

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Image(systemName: icon)
      Text(word)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
    .font(.system(size: 13, weight: .semibold))
    .foregroundStyle(state == .done ? p.ink : p.meta)
    .frame(minHeight: 26, alignment: .leading)
  }
}
