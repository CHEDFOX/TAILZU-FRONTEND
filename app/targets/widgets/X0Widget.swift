import SwiftUI
import WidgetKit

// X0: ONE WIDGET FOR THE WHOLE APP (docs/widget-glance-v2.md, backend repo; the approved design: the universal widget sheet).
// It picks what matters most right now and leads with it:
//
//   1. something needs you   a bot's question with its answers, answered right here (AnswerNeedIntent, the widgets' token)
//   2. bots working          the running job: its bot's face, the task, the stage bar; who else is busy and with what
//      (+ done)              the newest finished thing: what it finished, its PR
//   3. all quiet             the greeting and the day's line, the week's beads, the crew, Ask (the peek-bot key)
//
// Home Screen small (158 x 158 on a 390 pt phone), medium (338 x 158) and large (338 x 354) draw their own margins (14 pt small,
// 16 pt medium and large: contentMarginsDisabled), so the painted X0 bot can hang off the top edge. White and ink in Light, the
// same inverted in Dark (X0Palette); the only colour is the bots' own (lifted 28% on dark). StandBy shows the small one on black.
// The Lock Screen's inline, rectangle and circle (X0Lock.swift) draw only the glance's `lock` words, never a question's.
//
// A tap off the pills opens the case's link: the question, the job, what finished; the quiet widget opens Home (the small one
// and the circle open Ask: the peek-bot key is theirs).

struct X0GlanceWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetKinds.x0, provider: X0Provider()) { entry in
      X0View(entry: entry)
    }
    // Gallery metadata, read before the app has ever run: compile-time literals.
    .configurationDisplayName("X0")
    .description("Your bots at a glance: what needs you, what they're doing, and Ask.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .systemLarge, .accessoryInline, .accessoryRectangular, .accessoryCircular,
    ])
    .contentMarginsDisabled()
  }
}

/// What the widget leads with, with what it draws.
enum X0Lead {
  case needs(X0Glance.Ask)
  case job(X0Glance.Job)
  /// A bot at work with no job of its own (Travel bot finding a hotel).
  case bot(X0Glance.Bot)
  case done(X0Glance.Done)
  case quiet
}

extension X0Glance {
  var leading: X0Lead {
    switch lead {
    case .needs:
      if let a = asks.first { return .needs(a) }
    case .done:
      if let d = lastDone { return .done(d) }
    case .working:
      if let j = job { return .job(j) }
      if let b = bots.first(where: { $0.working }) { return .bot(b) }
    case .quiet:
      break
    }
    return .quiet
  }
}

struct X0View: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme
  @Environment(\.showsWidgetContainerBackground) private var showsBackground
  let entry: X0Entry

  private var p: X0Palette { X0Palette.of(scheme) }
  private var lead: X0Lead { entry.glance?.leading ?? .quiet }
  private var isAccessory: Bool {
    family == .accessoryInline || family == .accessoryRectangular || family == .accessoryCircular
  }
  private var c: X0Context {
    X0Context(g: entry.glance, p: p, states: entry.states, now: entry.date, rim: p.onDark || !showsBackground)
  }

  var body: some View {
    content
      .containerBackground(isAccessory ? Color.clear : p.ground, for: .widget)
      .widgetURL(tapURL)
  }

  @ViewBuilder
  private var content: some View {
    switch family {
    case .accessoryInline:
      X0Inline(c: c, lead: lead)
    case .accessoryRectangular:
      X0Rectangle(c: c, lead: lead)
    case .accessoryCircular:
      X0Circle(c: c, lead: lead)
    case .systemSmall:
      X0Small(c: c, lead: lead)
    case .systemLarge:
      X0Large(c: c, lead: lead)
    default:
      X0Medium(c: c, lead: lead)
    }
  }

  /// A tap off the pills: the case's own link.
  private var tapURL: URL? {
    switch lead {
    case .needs(let a): return a.decideLink ?? a.link ?? c.home
    case .job(let j): return j.link ?? c.home
    case .bot(let b): return b.link ?? c.home
    case .done(let d): return d.link ?? c.home
    case .quiet:
      if family == .systemSmall || family == .accessoryCircular { return entry.glance?.askURL ?? X0Links.ask }
      return c.home
    }
  }
}

// ------------------------------------------------------------------ the words every size shares

extension X0Context {
  var hello: String {
    guard let g else { return x0Name }
    return g.hello.isEmpty ? word("brand", x0Name) : g.hello
  }

  /// The day's line; else the situation line; else the literal.
  var dayLine: String {
    guard let g else { return "Open X0 to see your bots here." }
    if !g.dayLine.isEmpty { return g.dayLine }
    if !g.summary.isEmpty { return g.summary }
    return word("ask", "Ask any bot…")
  }

  func askName(_ a: X0Glance.Ask) -> String { name(a.bot, a.botName) }

  /// The question, or (no words sent) that the bot needs the person.
  func question(_ a: X0Glance.Ask) -> String {
    a.question.isEmpty ? askName(a) + " " + lowerFirst(word("needsYou", "Needs you")) : a.question
  }

  /// How the pills of a question answer: right here, or by opening it.
  func tap(_ a: X0Glance.Ask) -> ChoiceTap {
    if a.answerable { return .widget(item: a.id) }
    if let url = a.decideLink ?? a.link { return .open(url) }
    return .drawn
  }

  /// "Code bot · Build, step 3 of 5".
  func jobLine(_ j: X0Glance.Job) -> String {
    let who = name(j.bot)
    let at = lowerFirst(step(j.stage, j.of))
    return j.stageName.isEmpty ? who + " · " + at : who + " · " + j.stageName + ", " + at
  }

  /// "Code bot · Build".
  func jobShortLine(_ j: X0Glance.Job) -> String {
    j.stageName.isEmpty ? name(j.bot) : name(j.bot) + " · " + j.stageName
  }

  /// "Code bot · PR #131 · 4 min ago".
  func doneLine(_ d: X0Glance.Done, pr: Bool = true) -> String {
    var parts = [name(d.bot, d.botName)]
    if pr, let n = d.prNumber { parts.append("PR #\(n)") }
    if let at = d.endedAt { parts.append(When.words(at, now: now)) }
    return parts.joined(separator: " · ")
  }

  func doneTitle(_ d: X0Glance.Done) -> String { d.result.isEmpty ? word("done", "Done") : d.result }

  /// The bots at work beside this one.
  func others(besides slug: String) -> [X0Glance.Bot] { g?.othersWorking(besides: slug) ?? [] }

  /// "+1 working".
  func moreWorking(_ n: Int) -> String { "+" + word("working", "{n} working", ["n": String(n)]) }
}

// ------------------------------------------------------------------ small: 158 x 158, its own 14 pt margins

struct X0Small: View {
  let c: X0Context
  let lead: X0Lead

  var body: some View {
    switch lead {
    case .needs(let a): SmallNeeds(c: c, ask: a)
    case .job(let j): SmallBusy(c: c, slug: j.bot, title: j.task, line: c.jobShortLine(j), job: j)
    case .bot(let b):
      SmallBusy(c: c, slug: b.slug, title: b.line.isEmpty ? b.name : upperFirst(b.line), line: b.name, job: nil)
    case .done(let d): SmallDone(c: c, done: d)
    case .quiet: SmallQuiet(c: c)
    }
  }
}

/// The bot's face and name with "needs you", its question, both answers in one capsule.
struct SmallNeeds: View {
  let c: X0Context
  let ask: X0Glance.Ask

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        c.face(ask.bot, ask.face, size: 32)
        VStack(alignment: .leading, spacing: 1) {
          Text(c.askName(ask))
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundStyle(c.p.ink)
            .lineLimit(1)
          HStack(spacing: 5) {
            NeedsDot(color: c.p.ink, size: 6)
            Text(lowerFirst(c.word("needsYou", "Needs you")))
              .font(.system(size: 11))
              .foregroundStyle(c.p.meta)
              .lineLimit(1)
          }
        }
      }
      Text(c.question(ask))
        .font(.system(size: 14, weight: .semibold))
        .tracking(-0.2)
        .foregroundStyle(c.p.ink)
        .lineLimit(3)
        .privacySensitive(ask.isPrivate)
        .padding(.top, 8)
      Spacer(minLength: 6)
      answers
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  @ViewBuilder
  private var answers: some View {
    if let state = c.states[ask.id] {
      AnswerOutcome(state: state, c: c, size: 12.5)
    } else if !ask.choices.isEmpty {
      // A small widget has no links of its own: answers that cannot be given here are drawn, and the widget opens the question.
      SplitAnswers(choices: ask.choices, tap: ask.answerable ? .widget(item: ask.id) : .drawn, p: c.p)
        .invalidatableContent()
    } else {
      X0Pill(label: c.word("youDecide", "You decide"), primary: true, p: c.p, fill: true, height: 30, size: 12)
    }
  }
}

/// A bot at work: its face (and the job's stage, "3/5"), what it is doing, the stage bar, and who else is busy.
struct SmallBusy: View {
  let c: X0Context
  let slug: String
  let title: String
  let line: String
  let job: X0Glance.Job?

  var body: some View {
    let tint = c.tint(slug)
    let others = c.others(besides: slug)
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: 4) {
        c.face(slug, size: 34)
        Spacer(minLength: 4)
        if let job {
          Text("\(job.stage)/\(job.of)")
            .font(.system(size: 12, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(tint)
        } else {
          WorkingDot(color: tint, size: 7)
        }
      }
      Text(title)
        .font(.system(size: 18, weight: .bold))
        .tracking(-0.4)
        .foregroundStyle(c.p.ink)
        .lineLimit(2)
        .padding(.top, 9)
      Text(line)
        .font(.system(size: 11.5))
        .foregroundStyle(c.p.meta)
        .lineLimit(1)
        .padding(.top, 1)
      Spacer(minLength: 6)
      if let job {
        StageBar(stage: job.stage, of: job.of, color: tint, track: c.p.line, height: 6)
      }
      if let other = others.first {
        HStack(spacing: 5) {
          c.face(other.slug, other.face, size: 16)
          Text(c.moreWorking(others.count))
            .font(.system(size: 10.5))
            .foregroundStyle(c.p.meta)
            .lineLimit(1)
        }
        .padding(.top, 8)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// What just finished: the face with a check, what it finished, whose and when, and the PR.
struct SmallDone: View {
  let c: X0Context
  let done: X0Glance.Done

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: 4) {
        c.face(done.bot, size: 34)
        Spacer(minLength: 4)
        CheckCircle(fill: c.p.ink, mark: c.p.ground, size: 22)
      }
      Text(c.doneTitle(done))
        .font(.system(size: 17, weight: .bold))
        .tracking(-0.4)
        .foregroundStyle(c.p.ink)
        .lineLimit(3)
        .padding(.top, 9)
      Text(c.doneLine(done, pr: false))
        .font(.system(size: 11.5))
        .foregroundStyle(c.p.meta)
        .lineLimit(1)
        .padding(.top, 1)
      Spacer(minLength: 6)
      if done.prNumber != nil {
        X0Pill(label: c.word("seePr", "See the PR"), primary: true, p: c.p, fill: true, height: 28, size: 12)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// All quiet: the painted bot hangs off the top, the peek-bot key (Ask) at the corner, the greeting and the day's line.
struct SmallQuiet: View {
  let c: X0Context

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(c.hello)
        .font(.system(size: 11.5))
        .foregroundStyle(c.p.meta)
        .lineLimit(1)
      Text(c.dayLine)
        .font(.system(size: 15, weight: .bold))
        .tracking(-0.35)
        .foregroundStyle(c.p.ink)
        .lineLimit(3)
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    .overlay(alignment: .topLeading) {
      HangingBot(width: 72, rim: c.rim).padding(.leading, 12)
    }
    .overlay(alignment: .topTrailing) {
      PeekKey(size: 36, rim: c.p.onDark, label: c.word("ask", "Ask any bot…")).padding(12)
    }
  }
}

// ------------------------------------------------------------------ medium: 338 x 158, its own 16 pt margins

struct X0Medium: View {
  let c: X0Context
  let lead: X0Lead

  var body: some View {
    switch lead {
    case .needs(let a): MediumNeeds(c: c, ask: a)
    case .job(let j): MediumBusy(c: c, slug: j.bot, title: j.task, line: c.jobLine(j), job: j)
    case .bot(let b):
      MediumBusy(c: c, slug: b.slug, title: b.line.isEmpty ? b.name : upperFirst(b.line), line: b.name, job: nil)
    case .done(let d): MediumDone(c: c, done: d)
    case .quiet: MediumQuiet(c: c)
    }
  }
}

/// The big face (and, under it, what the bot is still at), NEEDS YOU · CODE BOT, the question, its answers.
struct MediumNeeds: View {
  let c: X0Context
  let ask: X0Glance.Ask

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(spacing: 6) {
        c.face(ask.bot, ask.face, size: 58)
        if let b = c.g?.bot(ask.bot), b.working, !b.line.isEmpty {
          HStack(spacing: 3) {
            WorkingDot(color: c.tint(ask.bot), size: 5)
            Text(b.line)
              .font(.system(size: 9.5, weight: .medium))
              .foregroundStyle(c.tint(ask.bot))
              .lineLimit(1)
              .minimumScaleFactor(0.8)
          }
          .frame(width: 70)
        }
      }
      .frame(width: 58)
      VStack(alignment: .leading, spacing: 0) {
        NeedsLabel(needsYou: c.word("needsYou", "Needs you"), botName: c.askName(ask), ink: c.p.ink)
        Text(c.question(ask))
          .font(.system(size: 15.5, weight: .semibold))
          .tracking(-0.25)
          .foregroundStyle(c.p.ink)
          .lineLimit(2)
          .privacySensitive(ask.isPrivate)
          .padding(.top, 6)
        Spacer(minLength: 6)
        X0Answers(c: c, ask: ask, height: 30, size: 12.5, decide: false)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .padding(16)
  }
}

/// A question's answers as pills (or how a pressed one went); on the large widget "You decide" after them.
struct X0Answers: View {
  let c: X0Context
  let ask: X0Glance.Ask
  var height: CGFloat = 30
  var size: CGFloat = 12.5
  var decide = false

  var body: some View {
    if let state = c.states[ask.id] {
      AnswerOutcome(state: state, c: c, size: size)
    } else if ask.choices.isEmpty {
      decideOnly
    } else {
      ChoiceRow(
        choices: ask.choices, tap: c.tap(ask), p: c.p, height: height, size: size,
        decide: decide ? c.word("youDecide", "You decide") : nil, decideURL: ask.decideLink ?? ask.link)
        .invalidatableContent()
    }
  }

  /// No answers to give here: one pill that opens the question.
  @ViewBuilder
  private var decideOnly: some View {
    let pill = X0Pill(label: c.word("youDecide", "You decide"), primary: true, p: c.p, height: height, size: size)
    if let url = ask.decideLink ?? ask.link {
      Link(destination: url) { pill }
    } else {
      pill
    }
  }
}

/// A bot at work: face, task, the stage bar with its names (and the minutes in); below, the other bot at work and what it is
/// doing, or the situation line.
struct MediumBusy: View {
  let c: X0Context
  let slug: String
  let title: String
  let line: String
  let job: X0Glance.Job?

  var body: some View {
    let tint = c.tint(slug)
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 12) {
        c.face(slug, size: 46)
        VStack(alignment: .leading, spacing: 1) {
          Text(title)
            .font(.system(size: 18, weight: .bold))
            .tracking(-0.4)
            .foregroundStyle(c.p.ink)
            .lineLimit(1)
          Text(line)
            .font(.system(size: 12))
            .foregroundStyle(c.p.meta)
            .lineLimit(1)
        }
        .padding(.top, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        if let job, let m = c.g?.minutesIn(job, now: c.now) {
          Text("\(m) min")
            .font(.system(size: 12))
            .monospacedDigit()
            .foregroundStyle(c.p.meta)
            .padding(.top, 3)
        }
      }
      if let job {
        StageBar(
          stage: job.stage, of: job.of, color: tint, track: c.p.line, height: 7, labels: job.stages, labelSize: 10, p: c.p)
          .padding(.top, 12)
      }
      Spacer(minLength: 4)
      OtherAtWork(c: c, besides: slug)
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// "Travel bot ● finding a hotel in Goa": the next bot at work; else the situation line.
struct OtherAtWork: View {
  let c: X0Context
  let besides: String

  var body: some View {
    if let o = c.others(besides: besides).first {
      HStack(spacing: 7) {
        c.face(o.slug, o.face, size: 20)
        Text(o.name)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(c.p.ink)
          .lineLimit(1)
          .fixedSize()
        if !o.line.isEmpty {
          HStack(spacing: 4) {
            WorkingDot(color: c.tint(o.slug), size: 6)
            Text(o.line)
              .font(.system(size: 12, weight: .medium))
              .foregroundStyle(c.tint(o.slug))
              .lineLimit(1)
          }
        }
      }
    } else if let s = c.g?.summary, !s.isEmpty {
      Text(s)
        .font(.system(size: 12))
        .foregroundStyle(c.p.meta)
        .lineLimit(1)
    }
  }
}

/// What just finished: face, what it finished, whose and when; the check; See the PR.
struct MediumDone: View {
  let c: X0Context
  let done: X0Glance.Done

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 12) {
        c.face(done.bot, size: 46)
        VStack(alignment: .leading, spacing: 1) {
          Text(c.doneTitle(done))
            .font(.system(size: 18, weight: .bold))
            .tracking(-0.4)
            .foregroundStyle(c.p.ink)
            .lineLimit(2)
          Text(c.doneLine(done))
            .font(.system(size: 12))
            .foregroundStyle(c.p.meta)
            .lineLimit(1)
        }
        .padding(.top, 3)
        .frame(maxWidth: .infinity, alignment: .leading)
        CheckCircle(fill: c.p.ink, mark: c.p.ground, size: 26)
      }
      Spacer(minLength: 6)
      HStack(spacing: 8) {
        if done.prNumber != nil {
          X0Pill(label: c.word("seePr", "See the PR"), primary: true, p: c.p, height: 30, size: 12.5)
        }
        Spacer(minLength: 0)
        if let o = c.others(besides: done.bot).first {
          c.face(o.slug, o.face, size: 20)
          Text(c.moreWorking(c.others(besides: done.bot).count))
            .font(.system(size: 12))
            .foregroundStyle(c.p.meta)
            .lineLimit(1)
        }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// All quiet: the greeting, the day's line, Ask any bot… with the peek-bot key; the painted bot hanging on.
struct MediumQuiet: View {
  let c: X0Context

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 4) {
        Text(c.hello)
          .font(.system(size: 12.5))
          .foregroundStyle(c.p.meta)
          .lineLimit(1)
        Text(c.dayLine)
          .font(.system(size: 19, weight: .bold))
          .tracking(-0.6)
          .foregroundStyle(c.p.ink)
          .lineLimit(2)
      }
      .padding(.trailing, 84)
      Spacer(minLength: 6)
      AskBar(c: c, height: 38, size: 13.5)
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .overlay(alignment: .topTrailing) {
      HangingBot(width: 86, rim: c.rim).padding(.trailing, 30)
    }
  }
}

// ------------------------------------------------------------------ large: 338 x 354, its own 16 pt margins

struct X0Large: View {
  let c: X0Context
  let lead: X0Lead

  var body: some View {
    switch lead {
    case .quiet:
      LargeQuiet(c: c)
    default:
      VStack(alignment: .leading, spacing: 0) {
        VStack(alignment: .leading, spacing: 4) {
          Text(c.hello)
            .font(.system(size: 12.5))
            .foregroundStyle(c.p.meta)
            .lineLimit(1)
          WeekLine(c: c)
        }
        LargeCard(c: c, lead: lead).padding(.top, 12)
        Seats(c: c).padding(.top, 14)
        Spacer(minLength: 8)
        AskBar(c: c, height: 40, size: 14)
      }
      .padding(16)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }
}

/// The card the large widget leads with: the question like Home's (with You decide), the running job, or what finished.
struct LargeCard: View {
  let c: X0Context
  let lead: X0Lead

  var body: some View {
    card
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay {
        RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(c.p.line, lineWidth: 1)
      }
  }

  @ViewBuilder
  private var card: some View {
    switch lead {
    case .needs(let a):
      VStack(alignment: .leading, spacing: 0) {
        questionWords(a)
        X0Answers(c: c, ask: a, height: 32, size: 13, decide: true).padding(.top, 12)
      }
      .padding(.horizontal, 14)
      .padding(.top, 12)
      .padding(.bottom, 14)
    case .job(let j):
      linked(j.link) { busy(slug: j.bot, title: j.task, line: c.jobShortLine(j), job: j) }
    case .bot(let b):
      linked(b.link) { busy(slug: b.slug, title: b.line.isEmpty ? b.name : upperFirst(b.line), line: b.name, job: nil) }
    case .done(let d):
      linked(d.link) { finished(d) }
    case .quiet:
      EmptyView()
    }
  }

  /// The words of a question open it; the pills under them answer it.
  @ViewBuilder
  private func questionWords(_ a: X0Glance.Ask) -> some View {
    let words = VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 6) {
        NeedsLabel(needsYou: c.word("needsYou", "Needs you"), botName: c.askName(a), ink: c.p.ink)
        Spacer(minLength: 4)
        c.face(a.bot, a.face, size: 30)
      }
      Text(c.question(a))
        .font(.system(size: 16, weight: .semibold))
        .tracking(-0.3)
        .foregroundStyle(c.p.ink)
        .lineLimit(2)
        .privacySensitive(a.isPrivate)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    if let url = a.decideLink ?? a.link {
      Link(destination: url) { words }
    } else {
      words
    }
  }

  @ViewBuilder
  private func linked<V: View>(_ url: URL?, @ViewBuilder _ content: () -> V) -> some View {
    if let url {
      Link(destination: url) { content() }
    } else {
      content()
    }
  }

  private func busy(slug: String, title: String, line: String, job: X0Glance.Job?) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: 12) {
        c.face(slug, size: 44)
        VStack(alignment: .leading, spacing: 1) {
          Text(title)
            .font(.system(size: 19, weight: .bold))
            .tracking(-0.45)
            .foregroundStyle(c.p.ink)
            .lineLimit(1)
          Text(line)
            .font(.system(size: 12))
            .foregroundStyle(c.p.meta)
            .lineLimit(1)
        }
      }
      if let job {
        StageBar(
          stage: job.stage, of: job.of, color: c.tint(slug), track: c.p.line, height: 7, labels: job.stages,
          labelSize: 9.5, p: c.p)
          .padding(.top, 14)
        stepLine(job).padding(.top, 10)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// "Step 3 of 5 · 52 min in".
  private func stepLine(_ job: X0Glance.Job) -> some View {
    let step = Text(c.step(job.stage, job.of)).fontWeight(.semibold).foregroundColor(c.p.ink)
    let minutes = c.g?.minutesIn(job, now: c.now).map { m in
      Text("  ·  " + c.word("minIn", "{n} min in", ["n": String(m)])).foregroundColor(c.p.meta)
    }
    return (minutes.map { step + $0 } ?? step)
      .font(.system(size: 11.5))
      .lineLimit(1)
  }

  private func finished(_ d: X0Glance.Done) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: 12) {
        c.face(d.bot, size: 44)
        VStack(alignment: .leading, spacing: 1) {
          Text(c.doneTitle(d))
            .font(.system(size: 19, weight: .bold))
            .tracking(-0.45)
            .foregroundStyle(c.p.ink)
            .lineLimit(2)
          Text(c.doneLine(d))
            .font(.system(size: 12))
            .foregroundStyle(c.p.meta)
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        CheckCircle(fill: c.p.ink, mark: c.p.ground, size: 30)
      }
      if d.prNumber != nil {
        X0Pill(label: c.word("seePr", "See the PR"), primary: false, p: c.p, height: 30, size: 12.5)
          .padding(.top, 12)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The crew: four bots, each its face, its name and where it is (needs you; at work, in its colour; else its line or Ready).
struct Seats: View {
  let c: X0Context

  var body: some View {
    let shown = Array((c.g?.bots ?? []).prefix(4))
    HStack(alignment: .top, spacing: 8) {
      ForEach(shown) { b in
        Link(destination: b.link ?? c.home) { Seat(c: c, bot: b) }
      }
      ForEach(0..<(4 - shown.count), id: \.self) { _ in
        Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
      }
    }
  }
}

struct Seat: View {
  let c: X0Context
  let bot: X0Glance.Bot

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      c.face(bot.slug, bot.face, size: 30)
      Text(bot.name)
        .font(.system(size: 11.5, weight: .semibold))
        .foregroundStyle(c.p.ink)
        .lineLimit(1)
        .padding(.top, 2)
      status
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var status: some View {
    if bot.state == "needs" || bot.needs > 0 {
      HStack(spacing: 4) {
        NeedsDot(color: c.p.ink, size: 6)
        Text(lowerFirst(c.word("needsYou", "Needs you")))
          .font(.system(size: 10.5, weight: .semibold))
          .foregroundStyle(c.p.ink)
          .lineLimit(1)
      }
    } else if bot.working {
      HStack(alignment: .top, spacing: 4) {
        WorkingDot(color: c.tint(bot.slug), size: 6).padding(.top, 4)
        Text(bot.line.isEmpty ? c.word("working", "{n} working", ["n": "1"]) : bot.line)
          .font(.system(size: 10.5, weight: .medium))
          .foregroundStyle(c.tint(bot.slug))
          .lineLimit(2)
      }
    } else {
      Text(bot.line.isEmpty ? c.word("ready", "Ready") : bot.line)
        .font(.system(size: 10.5))
        .foregroundStyle(c.p.meta)
        .lineLimit(2)
    }
  }
}

/// All quiet: the big day line beside the hanging bot, the week's beads, the crew all Ready, Ask. Nothing red, nothing owed.
struct LargeQuiet: View {
  let c: X0Context

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 6) {
        Text(c.hello)
          .font(.system(size: 13))
          .foregroundStyle(c.p.meta)
          .lineLimit(1)
        Text(c.dayLine)
          .font(.system(size: 24, weight: .bold))
          .tracking(-0.8)
          .foregroundStyle(c.p.ink)
          .lineLimit(3)
      }
      .padding(.trailing, 114)
      if c.g != nil {
        WeekLine(c: c).padding(.top, 12)
      }
      Spacer(minLength: 8)
      Seats(c: c)
      AskBar(c: c, height: 40, size: 14).padding(.top, 14)
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .overlay(alignment: .topTrailing) {
      HangingBot(width: 104, rim: c.rim).padding(.trailing, 24)
    }
  }
}
