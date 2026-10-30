import ActivityKit
import SwiftUI
import WidgetKit

// "BOTS AT WORK": A RUNNING JOB AS A LIVE ACTIVITY (docs/widget-glance-v2.md §6, backend repo; the approved design: the
// universal widget sheet's Live Activity row). It starts when a job starts, moves on stage by stage, turns into the question
// when the job waits on the person, and ends with what it made:
//
//   working   the bot's face, the task, "Code bot · Build, step 3 of 5", the minutes in, the stage bar with its names
//   needs     NEEDS YOU · CODE BOT, the question, its answers (answered right here: AnswerBotsActivityIntent, run in the
//             app's process with the widgets' own token) and "You decide" (opens the question)
//   done      "Done — tap to see the PR", the task · PR #131 · 58 min, every stage filled; a tap opens the job and its PR
//
// The Lock Screen banner is the palette's ground (light, or dark in Dark Mode); the Dynamic Island is always black: compact,
// the face and five tiny segments (● 1 when it needs the person, ✓ Done when finished); minimal, the face; expanded, the face,
// 3/5 (NEEDS YOU, or the check), the task and its step, the bar (the question and its answers; See the PR).
//
// The state is the activity's own (BotsAtWorkAttributes, _shared/BotsAtWork.swift), sent by the app (the bridge's
// start/update/endBotsActivity) or pushed by the server; the words are the glance's (X0Glance words), each with its literal.

struct BotsActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BotsAtWorkAttributes.self) { context in
      BotsLockScreen(job: context.attributes.jobId, state: context.state, g: X0Glance.load())
        .widgetURL(context.state.tapURL)
    } dynamicIsland: { context in
      let g = X0Glance.load()
      let s = context.state
      let job = context.attributes.jobId
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          BotsFace(state: s, g: g, size: 44, dark: true)
            .padding(.leading, 6)
            .padding(.top, 2)
        }
        DynamicIslandExpandedRegion(.trailing) {
          BotsIslandTrailing(state: s, g: g)
            .padding(.trailing, 6)
            .padding(.top, 6)
        }
        DynamicIslandExpandedRegion(.bottom) {
          BotsIslandBottom(job: job, state: s, g: g)
            .padding(.horizontal, 6)
            .padding(.top, 2)
        }
      } compactLeading: {
        BotsFace(state: s, g: g, size: 24, dark: true, disc: true)
      } compactTrailing: {
        BotsCompactTrailing(state: s, g: g)
      } minimal: {
        BotsFace(state: s, g: g, size: 24, dark: true, disc: true)
      }
      .widgetURL(s.tapURL)
      .keylineTint(BotsWords(g).tint(s, dark: true))
    }
  }
}

// ------------------------------------------------------------------ reading the state

extension BotsAtWorkAttributes.ContentState {
  var isNeeds: Bool { phase == "needs" }
  var isDone: Bool { phase == "done" }

  /// Where a tap goes: the question while it waits, else the job (whose page shows its PR).
  var tapURL: URL? {
    if isNeeds, let url = appLink(decideLink) { return url }
    return appLink(link) ?? URL(string: "tulmi://")
  }

  /// Minutes the job has run, as of now (the activity is drawn again on every update); done: how long it took.
  var minutesIn: Int? {
    if isDone, let minutes { return max(0, minutes) }
    guard startedAt > 0 else { return nil }
    return wholeMinutes(Date().timeIntervalSince1970 - startedAt / 1000)
  }

  var answers: [X0Choice] {
    (choices ?? []).prefix(3).map { X0Choice(id: $0.id, label: $0.label, primary: $0.primary ?? false) }
  }

  /// How its answers are pressed: right here when it names the item they answer, else drawn (a tap opens the question).
  func tap(job: String) -> ChoiceTap {
    guard let item = itemId, !item.isEmpty else { return .drawn }
    return .activity(job: job, item: item)
  }
}

/// The glance's words and colours, for the activity.
struct BotsWords {
  let g: X0Glance?

  init(_ g: X0Glance?) { self.g = g }

  func word(_ key: String, _ fallback: String) -> String { g?.word(key, fallback) ?? fallback }

  func word(_ key: String, _ fallback: String, _ fill: [String: String]) -> String {
    fill.reduce(word(key, fallback)) { $0.replacingOccurrences(of: "{\($1.key)}", with: $1.value) }
  }

  func tint(_ s: BotsAtWorkAttributes.ContentState, dark: Bool) -> Color {
    BotInk.tint(s.bot, hex: g?.bot(s.bot)?.color, dark: dark) ?? (dark ? Color.white : Color(rgb: 0x0A0A0A))
  }

  /// "Code bot · Build, step 3 of 5".
  func stepLine(_ s: BotsAtWorkAttributes.ContentState) -> String {
    let step = lowerFirst(word("step", "Step {stage} of {of}", ["stage": String(s.stage), "of": String(s.of)]))
    let who = s.botName.isEmpty ? s.bot : s.botName
    return s.stageName.isEmpty ? who + " · " + step : who + " · " + s.stageName + ", " + step
  }

  /// "Done — tap to see the PR", or (no PR) what it finished.
  func doneTitle(_ s: BotsAtWorkAttributes.ContentState) -> String {
    if s.pr != nil { return word("doneSeePr", word("done", "Done") + " — tap to see the PR") }
    if let r = s.result, !r.isEmpty { return r }
    return word("done", "Done")
  }

  /// "Fixing cart · PR #131 · 58 min".
  func doneLine(_ s: BotsAtWorkAttributes.ContentState) -> String {
    var parts = [s.task]
    if let pr = s.pr { parts.append("PR #\(pr.number)") }
    if let m = s.minutesIn { parts.append("\(m) min") }
    return parts.filter { !$0.isEmpty }.joined(separator: " · ")
  }

  /// The question, or (a private one, sent without its words) that the bot needs the person.
  func question(_ s: BotsAtWorkAttributes.ContentState) -> String {
    if let q = s.question, !q.isEmpty { return q }
    return (s.botName.isEmpty ? s.bot : s.botName) + " " + lowerFirst(word("needsYou", "Needs you"))
  }
}

/// The bot's face; in the island's compact and minimal places, on a dark disc.
struct BotsFace: View {
  let state: BotsAtWorkAttributes.ContentState
  let g: X0Glance?
  let size: CGFloat
  var dark = false
  var disc = false

  var body: some View {
    let face = BotFace(
      face: g?.face(state.bot, state.face ?? "") ?? (state.face ?? state.bot),
      name: state.botName.isEmpty ? state.bot : state.botName,
      color: BotsWords(g).tint(state, dark: dark), size: size)
    if disc {
      face
        .background { Circle().fill(Color(rgb: 0x1A1A1A)) }
        .clipShape(Circle())
    } else {
      face
    }
  }
}

/// The stage bar for a state: every stage filled when done; its names under it when it has them.
struct BotsBar: View {
  let state: BotsAtWorkAttributes.ContentState
  let p: X0Palette
  let tint: Color
  var labels = true

  var body: some View {
    StageBar(
      stage: state.isDone ? state.of : state.stage, of: state.of, color: tint, track: p.line, height: 6,
      done: state.isDone, labels: labels ? state.stages : [], labelSize: 10, p: p)
  }
}

// ------------------------------------------------------------------ the Lock Screen banner

struct BotsLockScreen: View {
  @Environment(\.colorScheme) private var scheme
  let job: String
  let state: BotsAtWorkAttributes.ContentState
  let g: X0Glance?

  var body: some View {
    let p = X0Palette.of(scheme)
    BotsBanner(job: job, state: state, w: BotsWords(g), g: g, p: p)
      .padding(.horizontal, 16)
      .padding(.vertical, 14)
      .activityBackgroundTint(p.ground)
      .activitySystemActionForegroundColor(p.ink)
  }
}

struct BotsBanner: View {
  let job: String
  let state: BotsAtWorkAttributes.ContentState
  let w: BotsWords
  let g: X0Glance?
  let p: X0Palette

  var body: some View {
    let tint = w.tint(state, dark: p.onDark)
    if state.isNeeds {
      HStack(alignment: .top, spacing: 12) {
        BotsFace(state: state, g: g, size: 44, dark: p.onDark)
        VStack(alignment: .leading, spacing: 0) {
          NeedsLabel(needsYou: w.word("needsYou", "Needs you"), botName: state.botName, ink: p.ink)
          Text(w.question(state))
            .font(.system(size: 15, weight: .semibold))
            .tracking(-0.25)
            .foregroundStyle(p.ink)
            .lineLimit(2)
            .padding(.top, 4)
          if !state.answers.isEmpty {
            ChoiceRow(
              choices: state.answers, tap: state.tap(job: job), p: p, height: 30, size: 12.5,
              decide: w.word("youDecide", "You decide"))
              .padding(.top, 10)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    } else {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .center, spacing: 12) {
          BotsFace(state: state, g: g, size: 44, dark: p.onDark)
          VStack(alignment: .leading, spacing: 1) {
            Text(state.isDone ? w.doneTitle(state) : state.task)
              .font(.system(size: 16, weight: .bold))
              .tracking(-0.3)
              .foregroundStyle(p.ink)
              .lineLimit(1)
              .minimumScaleFactor(0.85)
            Text(state.isDone ? w.doneLine(state) : w.stepLine(state))
              .font(.system(size: 12.5))
              .foregroundStyle(p.meta)
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          if state.isDone {
            CheckCircle(fill: p.ink, mark: p.ground, size: 30)
          } else if let m = state.minutesIn {
            Text("\(m) min")
              .font(.system(size: 12))
              .monospacedDigit()
              .foregroundStyle(p.meta)
              .frame(maxHeight: 44, alignment: .top)
          }
        }
        BotsBar(state: state, p: p, tint: tint)
      }
    }
  }
}

// ------------------------------------------------------------------ the Dynamic Island (always black)

/// The compact right: five tiny segments while working; ● 1 when it needs the person; ✓ Done when finished.
struct BotsCompactTrailing: View {
  let state: BotsAtWorkAttributes.ContentState
  let g: X0Glance?

  var body: some View {
    let w = BotsWords(g)
    let tint = w.tint(state, dark: true)
    if state.isNeeds {
      HStack(spacing: 5) {
        NeedsDot(color: .white, size: 7)
        Text("1")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(Color.white)
      }
    } else if state.isDone {
      HStack(spacing: 4) {
        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold))
        Text(w.word("done", "Done")).font(.system(size: 12, weight: .semibold)).lineLimit(1)
      }
      .foregroundStyle(tint)
    } else {
      HStack(spacing: 2) {
        ForEach(1...max(1, min(6, state.of)), id: \.self) { i in
          RoundedRectangle(cornerRadius: 2.5)
            .fill(i < state.stage ? tint : i == state.stage ? tint.opacity(0.67) : Color(rgb: 0x333333))
            .frame(width: 6, height: 5)
        }
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(state.stage)/\(state.of)")
    }
  }
}

/// The expanded right: 3/5; NEEDS YOU; or a white check.
struct BotsIslandTrailing: View {
  let state: BotsAtWorkAttributes.ContentState
  let g: X0Glance?

  var body: some View {
    let w = BotsWords(g)
    if state.isNeeds {
      Text(w.word("needsYou", "Needs you").uppercased())
        .font(.system(size: 11, weight: .semibold))
        .tracking(0.4)
        .foregroundStyle(X0Palette.island.meta)
        .lineLimit(1)
    } else if state.isDone {
      CheckCircle(fill: .white, mark: .black, size: 26)
    } else {
      Text("\(state.stage)/\(state.of)")
        .font(.system(size: 14, weight: .bold))
        .monospacedDigit()
        .foregroundStyle(w.tint(state, dark: true))
    }
  }
}

/// The expanded body: the task and its step, the bar; the question and its answers; Done and See the PR.
struct BotsIslandBottom: View {
  let job: String
  let state: BotsAtWorkAttributes.ContentState
  let g: X0Glance?

  var body: some View {
    let w = BotsWords(g)
    let p = X0Palette.island
    if state.isNeeds {
      VStack(alignment: .leading, spacing: 12) {
        Text(w.question(state))
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(p.ink)
          .lineLimit(2)
          .frame(maxWidth: .infinity, alignment: .leading)
        if !state.answers.isEmpty {
          ChoiceRow(
            choices: state.answers, tap: state.tap(job: job), p: p, height: 32, size: 13,
            decide: w.word("youDecide", "You decide"), decideURL: state.tapURL)
        }
      }
    } else if state.isDone {
      VStack(alignment: .leading, spacing: 12) {
        VStack(alignment: .leading, spacing: 1) {
          Text(w.doneTitle(state))
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(p.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
          Text(w.doneLine(state))
            .font(.system(size: 12.5))
            .foregroundStyle(p.meta)
            .lineLimit(1)
        }
        if state.pr != nil, let url = state.tapURL {
          Link(destination: url) {
            Text(w.word("seePr", "See the PR"))
              .font(.system(size: 14, weight: .semibold))
              .foregroundStyle(Color.black)
              .frame(maxWidth: .infinity)
              .frame(height: 36)
              .background { Capsule().fill(Color.white) }
          }
        }
      }
    } else {
      VStack(alignment: .leading, spacing: 12) {
        VStack(alignment: .leading, spacing: 1) {
          Text(state.task)
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(p.ink)
            .lineLimit(1)
          Text(state.minutesIn.map { w.stepLine(state) + " · \($0) min" } ?? w.stepLine(state))
            .font(.system(size: 12.5))
            .foregroundStyle(p.meta)
            .lineLimit(1)
        }
        BotsBar(state: state, p: p, tint: w.tint(state, dark: true))
      }
    }
  }
}
