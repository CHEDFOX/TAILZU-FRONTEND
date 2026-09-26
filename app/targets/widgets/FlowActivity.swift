import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// THE FLOW SESSION, AS A LIVE ACTIVITY. The app holds the microphone in the
// background so the keyboard can dictate; this is where that is visible —
// on the Lock Screen and in the Dynamic Island — and where it can be stopped.
// Ready between dictations, listening with the words so far, writing after.
// The words are a count: what was said never appears here.
//
// The attributes are declared once more, byte for byte, in the app's bridge
// module (FlowLiveActivity.swift). ActivityKit matches the two by the type's
// name and its encoding, so the two copies must stay identical.
//
// The words (and the symbols) are the server's: the app writes them to the
// App Group as "tulmi.widget.flow.copy" (setFlowActivityCopy, from the
// widget.flow.* labels), and each one read here falls back to the word it
// replaced. The colours are Ink's, from the month's JSON.

/// The activity's words, as the app last wrote them.
enum FlowCopy {
  static func text(_ key: String, _ fallback: String) -> String {
    guard let raw = Shared.store?.string(forKey: "tulmi.widget.flow.copy"),
          let data = raw.data(using: .utf8),
          let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let s = dict[key] as? String
    else { return fallback }
    return s
  }

  /// A word with its `{n}` filled in.
  static func text(_ key: String, _ fallback: String, n value: String) -> String {
    text(key, fallback).replacingOccurrences(of: "{n}", with: value)
  }
}

struct FlowActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "ready" | "listening" | "writing"
    var phase: String
    /// Words this session so far.
    var words: Int
    /// When the session ends itself if nothing happens.
    var until: Date
  }
  var startedAt: Date
}

/// The buttons run in this extension and reach the app the way the keyboard
/// does: a Darwin notification the Flow session already listens for. No shared
/// code, no process launch — the same nudge, from a different place.
private func nudge(_ name: String) {
  CFNotificationCenterPostNotification(
    CFNotificationCenterGetDarwinNotifyCenter(),
    CFNotificationName(name as CFString), nil, nil, true)
}

struct StopDictationIntent: AppIntent {
  static let title: LocalizedStringResource = "Stop dictating"
  static let description = IntentDescription("Finish the sentence being dictated.")
  func perform() async throws -> some IntentResult {
    nudge("space.tailzu.tulmi.flow.stop")
    return .result()
  }
}

struct EndFlowSessionIntent: AppIntent {
  static let title: LocalizedStringResource = "End Flow session"
  static let description = IntentDescription("Turn the background microphone off.")
  func perform() async throws -> some IntentResult {
    nudge("space.tailzu.tulmi.flow.end")
    return .result()
  }
}

struct FlowActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: FlowActivityAttributes.self) { context in
      FlowBanner(state: context.state)
        .activityBackgroundTint(Ink.ground)
        .activitySystemActionForegroundColor(Ink.pale)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          FlowTitle(state: context.state).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          FlowButtons(phase: context.state.phase)
        }
      } compactLeading: {
        Image(systemName: context.state.phase == "listening"
              ? FlowCopy.text("iconListening", "waveform")
              : FlowCopy.text("iconIdle", "mic"))
          .foregroundStyle(context.state.phase == "listening" ? Ink.mark : Ink.dim)
      } compactTrailing: {
        Text(context.state.phase == "listening"
             ? String(context.state.words)
             : FlowCopy.text("compact", "Flow"))
          .font(.system(size: 12, weight: .medium, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(Ink.dim)
      } minimal: {
        Image(systemName: FlowCopy.text("iconMinimal", "waveform")).foregroundStyle(Ink.mark)
      }
      .keylineTint(Ink.dim)
    }
  }
}

func phaseWord(_ phase: String) -> String {
  switch phase {
  case "listening": return FlowCopy.text("listening", "Listening")
  case "writing": return FlowCopy.text("writing", "Writing")
  default: return FlowCopy.text("ready", "Flow is on")
  }
}

/// The phase, and under it the count (or, when ready, the server's hint —
/// none unless it sends one).
struct FlowTitle: View {
  let state: FlowActivityAttributes.ContentState
  private var detail: String {
    state.phase == "ready"
      ? FlowCopy.text("readyHint", "")
      : FlowCopy.text("words", "{n} words", n: n(state.words))
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(phaseWord(state.phase)).font(.system(size: 15, weight: .medium)).foregroundStyle(Ink.pale)
      if !detail.isEmpty {
        Text(detail).font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.dim).lineLimit(1)
      }
    }
  }
}

/// The Lock Screen banner: the mark, the phase, the buttons.
struct FlowBanner: View {
  let state: FlowActivityAttributes.ContentState
  var body: some View {
    HStack(spacing: 12) {
      WaveMark(color: state.phase == "listening" ? Ink.mark : Ink.dim).frame(width: 26, height: 18)
      FlowTitle(state: state)
      Spacer(minLength: 8)
      FlowButtons(phase: state.phase)
    }
    .padding(16)
  }
}

/// Stop the sentence while listening; end the session otherwise. Round,
/// symbol only (the word stays for VoiceOver).
struct FlowButtons: View {
  let phase: String
  var body: some View {
    HStack(spacing: 8) {
      if phase == "listening" {
        Button(intent: StopDictationIntent()) {
          Label(FlowCopy.text("stop", "Stop"), systemImage: FlowCopy.text("iconStop", "stop.fill"))
            .labelStyle(.iconOnly)
            .font(.system(size: 12, weight: .semibold))
            .frame(width: 34, height: 34)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Ink.ground)
        .background(Ink.pale, in: Circle())
      }
      Button(intent: EndFlowSessionIntent()) {
        Label(FlowCopy.text("end", "End"), systemImage: FlowCopy.text("iconEnd", "xmark"))
          .labelStyle(.iconOnly)
          .font(.system(size: 12, weight: .semibold))
          .frame(width: 34, height: 34)
      }
      .buttonStyle(.plain)
      .foregroundStyle(Ink.pale)
      .background(Ink.rule, in: Circle())
    }
  }
}
