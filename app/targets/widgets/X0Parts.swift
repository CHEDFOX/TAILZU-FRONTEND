import AppIntents
import SwiftUI
import WidgetKit

// THE PARTS THE X0 WIDGET AND THE BOTS AT WORK LIVE ACTIVITY DRAW (the approved design: the universal widget sheet, its
// generator's ukit.js). A bot's face, the stage bar (the goal gradient: one segment per stage, the done ones filled, the current
// one filling, striped), the week's beads, the status marks (working: the bot's colour with its halo; needs you: filled ink),
// the keyboard's peek-bot key (backend experience/bots/glyphs.ts peekKey, rendered as drawn into Assets.xcassets/X0Peek), the
// painted X0 bot hanging off the top edge (X0Hang), the Ask bar, and the answer pills with what pressing one does.

/// Where a tap goes when the glance names nowhere.
enum X0Links {
  static let home = URL(string: "tulmi://")!
  static let ask = URL(string: "tulmi://screen/bots.ask")!
  static let mic = URL(string: "tulmi://screen/bots.ask?voice=1")!
}

/// A server word with its first letter lowered, as it reads mid-line ("Needs you" → "needs you", "Step 3 of 5" → "step 3 of 5").
func lowerFirst(_ s: String) -> String {
  guard let f = s.first else { return s }
  return f.lowercased() + s.dropFirst()
}

/// A server line with its first letter raised, as it reads as a title ("finding a hotel" → "Finding a hotel").
func upperFirst(_ s: String) -> String {
  guard let f = s.first else { return s }
  return f.uppercased() + s.dropFirst()
}

/// Everything a widget view needs: the glance (or none yet), the palette, what the pills did, the entry's moment, and whether
/// the painted bot needs its rim (a dark ground, or StandBy's black).
struct X0Context {
  let g: X0Glance?
  let p: X0Palette
  let states: [String: RowState]
  let now: Date
  let rim: Bool

  func word(_ key: String, _ fallback: String) -> String { g?.word(key, fallback) ?? fallback }

  func word(_ key: String, _ fallback: String, _ fill: [String: String]) -> String {
    fill.reduce(word(key, fallback)) { $0.replacingOccurrences(of: "{\($1.key)}", with: $1.value) }
  }

  func tint(_ slug: String) -> Color {
    g?.tint(slug, p) ?? BotInk.tint(slug, dark: p.onDark) ?? p.ink
  }

  func name(_ slug: String, _ named: String = "") -> String {
    if !named.isEmpty { return named }
    return g?.bot(slug)?.name ?? slug
  }

  func face(_ slug: String, _ named: String = "", size: CGFloat) -> BotFace {
    BotFace(face: g?.face(slug, named) ?? (named.isEmpty ? slug : named), name: name(slug), color: tint(slug), size: size)
  }

  var home: URL { g?.homeURL ?? X0Links.home }

  /// "Step 3 of 5".
  func step(_ stage: Int, _ of: Int) -> String {
    word("step", "Step {stage} of {of}", ["stage": String(stage), "of": String(of)])
  }
}

/// A bot's face: its head (the App Group's faces/<face>.png, or a built-in bot's bundled one), else a disc in its colour with
/// its initial.
struct BotFace: View {
  let face: String
  let name: String
  let color: Color
  var size: CGFloat = 30

  var body: some View {
    Group {
      if let img = X0Faces.image(face) {
        Image(uiImage: img)
          .resizable()
          .interpolation(.medium)
          .aspectRatio(contentMode: .fit)
      } else {
        Circle()
          .fill(color)
          .overlay {
            Text(initial)
              .font(.system(size: size * 0.42, weight: .semibold))
              .foregroundStyle(Color.white)
              .lineLimit(1)
          }
      }
    }
    .frame(width: size, height: size)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(name)
  }

  private var initial: String { name.first.map { String($0).uppercased() } ?? "" }
}

/// Diagonal stripes ("////"): the current stage, filling.
struct Stripes: Shape {
  var band: CGFloat = 4
  var gap: CGFloat = 3

  func path(in rect: CGRect) -> Path {
    var path = Path()
    let step = max(1, (band + gap) * 1.4142)
    let w = band * 1.4142
    let h = rect.height
    var x = rect.minX - h
    while x < rect.maxX {
      path.move(to: CGPoint(x: x, y: rect.maxY))
      path.addLine(to: CGPoint(x: x + h, y: rect.minY))
      path.addLine(to: CGPoint(x: x + h + w, y: rect.minY))
      path.addLine(to: CGPoint(x: x + w, y: rect.maxY))
      path.closeSubpath()
      x += step
    }
    return path
  }
}

/// The goal gradient: one segment per stage in the bot's colour, the done ones filled, the current one striped, the rest the
/// track; under it, when given, the stages' names (the current one bold in ink, the done ones meta, the rest dim).
struct StageBar: View {
  let stage: Int
  let of: Int
  let color: Color
  let track: Color
  var height: CGFloat = 6
  var gap: CGFloat = 3
  /// Every stage done (the finished job).
  var done = false
  var labels: [String] = []
  var labelSize: CGFloat = 10
  var p: X0Palette? = nil

  private var count: Int { max(1, min(8, of)) }

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      HStack(spacing: gap) {
        ForEach(0..<count, id: \.self) { i in
          segment(i + 1)
        }
      }
      if let p, labels.count >= count {
        HStack(spacing: gap) {
          ForEach(0..<count, id: \.self) { i in
            label(i + 1, p)
          }
        }
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(labels.indices.contains(stage - 1) ? labels[stage - 1] : "\(stage)/\(of)")
  }

  @ViewBuilder
  private func segment(_ n: Int) -> some View {
    if done || n < stage {
      Capsule().fill(color).frame(height: height)
    } else if n == stage {
      Capsule()
        .fill(color.opacity(0.6))
        .overlay { Stripes().fill(color) }
        .clipShape(Capsule())
        .frame(height: height)
    } else {
      Capsule().fill(track).frame(height: height)
    }
  }

  private func label(_ n: Int, _ p: X0Palette) -> some View {
    let current = n == stage && !done
    return Text(labels[n - 1])
      .font(.system(size: labelSize, weight: current ? .bold : .medium))
      .foregroundStyle(current ? p.ink : (n < stage || done) ? p.meta : p.dim)
      .lineLimit(1)
      .minimumScaleFactor(0.75)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The same stages as a ring (the Lock Screen's circle): one arc per stage, done ones solid, the current one dashed.
struct StageRing: View {
  let stage: Int
  let of: Int
  var width: CGFloat = 5

  private var count: Int { max(1, min(8, of)) }

  var body: some View {
    ZStack {
      ForEach(0..<count, id: \.self) { i in
        arc(i)
      }
    }
    .padding(width / 2 + 0.5)
  }

  private func arc(_ i: Int) -> some View {
    let gap = 9.0 / 360
    let from = Double(i) / Double(count) + gap / 2
    let to = Double(i + 1) / Double(count) - gap / 2
    let n = i + 1
    return Circle()
      .trim(from: from, to: max(from, to))
      .stroke(
        Color.white.opacity(n < stage ? 1 : n == stage ? 0.75 : 0.25),
        style: StrokeStyle(lineWidth: width, lineCap: .round, dash: n == stage ? [3, 2.2] : []))
      .rotationEffect(.degrees(-90))
  }
}

/// The week's beads: one filled per dot (0–5), and always one open: the next.
struct Beads: View {
  let dots: Int
  let ink: Color
  let hollow: Color
  var size: CGFloat = 7
  var gap: CGFloat = 4

  var body: some View {
    HStack(spacing: gap) {
      ForEach(0..<max(0, min(5, dots)), id: \.self) { _ in
        Circle().fill(ink).frame(width: size, height: size)
      }
      Circle().strokeBorder(hollow, lineWidth: 1.5).frame(width: size, height: size)
    }
    .accessibilityHidden(true)
  }
}

/// Needs you: a filled ink dot.
struct NeedsDot: View {
  let color: Color
  var size: CGFloat = 7

  var body: some View {
    Circle().fill(color).frame(width: size, height: size)
  }
}

/// Working: the bot's colour, with its halo.
struct WorkingDot: View {
  let color: Color
  var size: CGFloat = 6

  var body: some View {
    Circle()
      .fill(color)
      .frame(width: size, height: size)
      .background {
        Circle().fill(color.opacity(0.2)).frame(width: size * 1.9, height: size * 1.9)
      }
  }
}

/// A filled circle with a check: finished.
struct CheckCircle: View {
  let fill: Color
  let mark: Color
  var size: CGFloat = 30

  var body: some View {
    Image(systemName: "checkmark")
      .font(.system(size: size * 0.43, weight: .bold))
      .foregroundStyle(mark)
      .frame(width: size, height: size)
      .background { Circle().fill(fill) }
  }
}

/// "● NEEDS YOU · CODE BOT".
struct NeedsLabel: View {
  let needsYou: String
  let botName: String
  let ink: Color
  var size: CGFloat = 10.5

  var body: some View {
    HStack(spacing: 6) {
      NeedsDot(color: ink, size: 7)
      Text(botName.isEmpty ? needsYou.uppercased() : needsYou.uppercased() + " · " + botName.uppercased())
        .font(.system(size: size, weight: .bold))
        .tracking(0.5)
        .foregroundStyle(ink)
        .lineLimit(1)
    }
  }
}

/// The keyboard's mic key: the bot peeking into his dark round window. On a dark ground a hairline rim keeps the window's edge.
struct PeekKey: View {
  let size: CGFloat
  var rim = false
  var label = "Ask"

  var body: some View {
    Image("X0Peek")
      .resizable()
      .interpolation(.high)
      .aspectRatio(contentMode: .fit)
      .frame(width: size, height: size)
      .overlay {
        if rim {
          Circle().strokeBorder(Color(rgb: 0x3A3A3A), lineWidth: 1)
        }
      }
      .accessibilityLabel(label)
  }
}

/// The painted X0 bot hanging from his clay bar, off the top edge (the app icon's bot). On a dark ground he gets a hairline rim
/// so he does not vanish.
struct HangingBot: View {
  let width: CGFloat
  let rim: Bool

  var body: some View {
    Image("X0Hang")
      .resizable()
      .interpolation(.high)
      .aspectRatio(contentMode: .fit)
      .frame(width: width, height: width * 267 / 447)
      .shadow(color: rim ? Color.white.opacity(0.75) : Color.clear, radius: 0.6)
      .shadow(color: rim ? Color.white.opacity(0.14) : Color.clear, radius: 7)
      .accessibilityHidden(true)
  }
}

/// Home's Ask bar: "Ask any bot…" (opens Ask) with the peek-bot key in it (opens Ask listening).
struct AskBar: View {
  let c: X0Context
  var height: CGFloat = 40
  var size: CGFloat = 14

  var body: some View {
    let words = c.word("ask", "Ask any bot…")
    HStack(spacing: 6) {
      Link(destination: c.g?.askURL ?? X0Links.ask) {
        Text(words)
          .font(.system(size: size))
          .foregroundStyle(c.p.meta)
          .lineLimit(1)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
          .contentShape(Rectangle())
      }
      Link(destination: c.g?.micURL ?? X0Links.mic) {
        PeekKey(size: height - 8, rim: c.p.onDark, label: words)
      }
    }
    .padding(.leading, height * 0.4)
    .padding(.trailing, 4)
    .frame(height: height)
    .background { Capsule().fill(c.p.surface) }
    .overlay { Capsule().strokeBorder(c.p.line, lineWidth: 1) }
  }
}

/// The week: its beads and its line ("4 things done this week · 2 h saved").
struct WeekLine: View {
  let c: X0Context
  var size: CGFloat = 11.5

  var body: some View {
    HStack(spacing: 8) {
      Beads(dots: c.g?.weekDots ?? 0, ink: c.p.ink, hollow: c.p.hollow)
      Text(c.g?.weekLine ?? "")
        .font(.system(size: size))
        .foregroundStyle(c.p.meta)
        .lineLimit(1)
    }
  }
}

// ------------------------------------------------------------------ answers

/// What pressing an answer does.
enum ChoiceTap {
  /// The X0 widget: answered in the extension (AnswerNeedIntent, the widgets' token).
  case widget(item: String)
  /// The Live Activity: answered in the app's process (AnswerBotsActivityIntent), which moves the activity on.
  case activity(job: String, item: String)
  /// Opens the question in the app.
  case open(URL)
  /// Drawn only: the whole surface opens the question.
  case drawn
}

/// One answer, as a button of the kind its surface allows.
struct ChoiceButton<Content: View>: View {
  let choice: X0Choice
  let tap: ChoiceTap
  let label: Content

  var body: some View {
    switch tap {
    case .widget(let item):
      Button(intent: AnswerNeedIntent(item: item, action: choice.id)) { label }
        .buttonStyle(.plain)
    case .activity(let job, let item):
      Button(intent: AnswerBotsActivityIntent(job: job, item: item, action: choice.id)) { label }
        .buttonStyle(.plain)
    case .open(let url):
      Link(destination: url) { label }
    case .drawn:
      label
    }
  }
}

/// Whether an answer is the filled one: the server's primary, else the first.
func isPrimary(_ c: X0Choice, in all: [X0Choice]) -> Bool {
  all.contains { $0.primary } ? c.primary : c.id == all.first?.id
}

/// The answers as pills, as many as fit whole (never a cut label), and "You decide" after them when it fits.
struct ChoiceRow: View {
  let choices: [X0Choice]
  let tap: ChoiceTap
  let p: X0Palette
  var height: CGFloat = 30
  var size: CGFloat = 12.5
  /// "You decide": a quiet pill, opening `decideURL` when given (else the surface's own tap opens the question).
  var decide: String? = nil
  var decideURL: URL? = nil

  var body: some View {
    ViewThatFits(in: .horizontal) {
      row(3, withDecide: true)
      row(3, withDecide: false)
      row(2, withDecide: false)
      row(1, withDecide: false)
    }
  }

  private func row(_ count: Int, withDecide: Bool) -> some View {
    HStack(spacing: 6) {
      ForEach(Array(choices.prefix(count))) { c in
        ChoiceButton(
          choice: c, tap: tap,
          label: X0Pill(label: c.label, primary: isPrimary(c, in: choices), p: p, height: height, size: size))
      }
      if withDecide, let decide {
        decidePill(decide)
      }
    }
  }

  @ViewBuilder
  private func decidePill(_ label: String) -> some View {
    let pill = X0Pill(label: label, primary: false, p: p, height: height, size: size, padding: 6, quiet: true)
    if let url = decideURL {
      Link(destination: url) { pill }
    } else {
      pill
    }
  }
}

/// The small widget's two answers in one capsule: the primary filled, the other outlined in ink.
struct SplitAnswers: View {
  let choices: [X0Choice]
  let tap: ChoiceTap
  let p: X0Palette

  var body: some View {
    let shown = Array(choices.prefix(2))
    HStack(spacing: 0) {
      ForEach(shown) { c in
        ChoiceButton(choice: c, tap: tap, label: half(c.label, filled: isPrimary(c, in: shown)))
      }
    }
    .frame(height: 30)
    .clipShape(Capsule())
    .overlay { Capsule().strokeBorder(p.ink, lineWidth: 1) }
  }

  private func half(_ label: String, filled: Bool) -> some View {
    Text(label)
      .font(.system(size: 11, weight: .semibold))
      .tracking(-0.15)
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      .foregroundStyle(filled ? p.ground : p.ink)
      .padding(.horizontal, 5)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(filled ? p.ink : Color.clear)
      .contentShape(Rectangle())
  }
}

/// How a pressed answer went, where the pills were, until the app writes a fresh glance.
struct AnswerOutcome: View {
  let state: RowState
  let c: X0Context
  var size: CGFloat = 13

  private var word: String {
    switch state {
    case .done: return c.word("done", "Done")
    case .gone: return c.word("answered", "Already answered")
    case .failed: return c.word("finish", "Open X0 to finish")
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
    HStack(spacing: 6) {
      Image(systemName: icon)
      Text(word)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
    .font(.system(size: size, weight: .semibold))
    .foregroundStyle(state == .done ? c.p.ink : c.p.meta)
    .frame(minHeight: 30, alignment: .leading)
  }
}
