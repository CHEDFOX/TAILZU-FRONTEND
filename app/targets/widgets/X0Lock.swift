import SwiftUI
import WidgetKit

// X0 ON THE LOCK SCREEN: inline (in the date line), rectangular and circular, rendered by the system in its vibrant style
// (white at strengths, faces turned to luminance). A locked phone is anyone's to read, so the words here are only the glance's
// `lock` words (lock.inline, lock.title, lock.line), which the server makes safe: a private question's words never reach them.
// A question's own text is never drawn here. Beside the words: a face, the stage bar or ring, the week's beads, the peek-bot key.

/// The line in the date: "● Code bot needs you", "Code bot · Build, 3 of 5", "X0 · 4 done this week".
struct X0Inline: View {
  let c: X0Context
  let lead: X0Lead

  private var needs: Bool {
    if case .needs = lead { return true }
    return false
  }

  private var words: String {
    if let s = c.g?.lockInline, !s.isEmpty { return s }
    switch lead {
    case .needs(let a): return c.askName(a) + " " + lowerFirst(c.word("needsYou", "Needs you"))
    case .job(let j): return c.name(j.bot) + " · " + c.step(j.stage, j.of)
    case .bot(let b): return b.name
    case .done(let d): return c.name(d.bot, d.botName) + " · " + c.word("done", "Done")
    case .quiet: return x0Name
    }
  }

  var body: some View {
    if needs {
      Label(words, systemImage: "circle.fill")
    } else {
      Text(words)
    }
  }
}

/// The rectangle (160 x 72): the face and the safe line when something needs the person; the task and the stage bar while a
/// job runs; the greeting and the week's beads when all is quiet.
struct X0Rectangle: View {
  let c: X0Context
  let lead: X0Lead

  private var title: String { c.g?.lockTitle ?? "" }
  private var line: String { c.g?.lockLine ?? "" }

  var body: some View {
    content.frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var content: some View {
    switch lead {
    case .needs(let a):
      HStack(alignment: .top, spacing: 7) {
        c.face(a.bot, a.face, size: 26)
        VStack(alignment: .leading, spacing: 1) {
          Text(title.isEmpty ? c.askName(a) + " " + lowerFirst(c.word("needsYou", "Needs you")) : title)
            .font(.system(size: 12.5, weight: .semibold))
            .lineLimit(1)
            .widgetAccentable()
          if !line.isEmpty {
            Text(line)
              .font(.system(size: 12.5))
              .foregroundStyle(.secondary)
              .lineLimit(2)
          }
        }
      }
    case .job(let j):
      VStack(alignment: .leading, spacing: 0) {
        Text(title.isEmpty ? j.task : title)
          .font(.system(size: 13, weight: .semibold))
          .lineLimit(1)
          .widgetAccentable()
        Text(line.isEmpty ? c.jobShortLine(j) : line)
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
          .lineLimit(1)
        StageBar(stage: j.stage, of: j.of, color: .white, track: Color.white.opacity(0.25), height: 5)
          .padding(.top, 6)
      }
    case .bot(let b):
      VStack(alignment: .leading, spacing: 0) {
        Text(title.isEmpty ? b.name : title)
          .font(.system(size: 13, weight: .semibold))
          .lineLimit(1)
          .widgetAccentable()
        Text(line.isEmpty ? b.line : line)
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
    case .done(let d):
      HStack(alignment: .top, spacing: 7) {
        c.face(d.bot, size: 26)
        VStack(alignment: .leading, spacing: 1) {
          Text(title.isEmpty ? c.doneTitle(d) : title)
            .font(.system(size: 12.5, weight: .semibold))
            .lineLimit(1)
            .widgetAccentable()
          Text(line.isEmpty ? c.doneLine(d) : line)
            .font(.system(size: 12.5))
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
    case .quiet:
      VStack(alignment: .leading, spacing: 5) {
        Text(title.isEmpty ? c.hello : title)
          .font(.system(size: 13, weight: .semibold))
          .lineLimit(1)
          .widgetAccentable()
        HStack(spacing: 7) {
          Beads(dots: c.g?.weekDots ?? 0, ink: .white, hollow: Color.white.opacity(0.45), size: 6, gap: 3)
          if !line.isEmpty {
            Text(line)
              .font(.system(size: 12))
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
      }
    }
  }
}

/// The circle (72 x 72): the face with the needs dot; the stages as a ring around the face; the face with a check; the
/// peek-bot key (Ask) when all is quiet.
struct X0Circle: View {
  let c: X0Context
  let lead: X0Lead

  var body: some View {
    switch lead {
    case .needs(let a):
      ZStack {
        AccessoryWidgetBackground()
        c.face(a.bot, a.face, size: 44)
      }
      .overlay(alignment: .topTrailing) {
        Circle()
          .fill(Color.white)
          .frame(width: 13, height: 13)
          .padding(2)
          .background { Circle().fill(Color.black) }
          .offset(x: -3, y: 3)
      }
      .accessibilityLabel(c.g?.lockInline ?? c.word("needsYou", "Needs you"))
    case .job(let j):
      ZStack {
        StageRing(stage: j.stage, of: j.of)
        c.face(j.bot, size: 36)
      }
    case .bot(let b):
      ZStack {
        AccessoryWidgetBackground()
        c.face(b.slug, b.face, size: 44)
      }
    case .done(let d):
      ZStack {
        AccessoryWidgetBackground()
        c.face(d.bot, size: 40)
      }
      .overlay(alignment: .topTrailing) {
        CheckCircle(fill: .white, mark: .black, size: 18).offset(x: -2, y: 2)
      }
    case .quiet:
      PeekKey(size: 64, label: c.word("ask", "Ask any bot…"))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}
