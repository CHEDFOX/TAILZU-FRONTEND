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
        .activitySystemActionForegroundColor(Ink.amber)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            WaveMark(color: context.state.phase == "listening" ? Ink.amber : Ink.dim).frame(width: 26, height: 18)
            Text(phaseWord(context.state.phase)).font(.system(size: 14, weight: .semibold)).foregroundStyle(Ink.pale)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(n(context.state.words)) words")
            .font(.system(size: 13, weight: .medium, design: .rounded))
            .foregroundStyle(Ink.dim)
        }
        DynamicIslandExpandedRegion(.bottom) {
          FlowButtons(phase: context.state.phase)
        }
      } compactLeading: {
        Image(systemName: context.state.phase == "listening" ? "waveform" : "mic")
          .foregroundStyle(Ink.amber)
      } compactTrailing: {
        Text(context.state.phase == "listening" ? "\(context.state.words)" : "Flow")
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .foregroundStyle(Ink.pale)
      } minimal: {
        Image(systemName: "waveform").foregroundStyle(Ink.amber)
      }
      .keylineTint(Ink.amber)
    }
  }
}

func phaseWord(_ phase: String) -> String {
  switch phase {
  case "listening": return "Listening"
  case "writing": return "Writing"
  default: return "Flow is on"
  }
}

/// The Lock Screen banner.
struct FlowBanner: View {
  let state: FlowActivityAttributes.ContentState
  var body: some View {
    HStack(spacing: 14) {
      WaveMark(color: state.phase == "listening" ? Ink.amber : Ink.dim).frame(width: 34, height: 24)
      VStack(alignment: .leading, spacing: 2) {
        Text(phaseWord(state.phase)).font(.system(size: 15, weight: .semibold)).foregroundStyle(Ink.pale)
        Text(state.phase == "ready"
             ? "Tap the mic on the keyboard to dictate."
             : "\(n(state.words)) words so far.")
          .font(.system(size: 12)).foregroundStyle(Ink.dim)
      }
      Spacer()
      FlowButtons(phase: state.phase)
    }
    .padding(14)
  }
}

/// Stop the sentence while listening; end the session otherwise.
struct FlowButtons: View {
  let phase: String
  var body: some View {
    HStack(spacing: 8) {
      if phase == "listening" {
        Button(intent: StopDictationIntent()) {
          Label("Stop", systemImage: "stop.fill")
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 12).padding(.vertical, 7)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Ink.ground)
        .background(Ink.amber, in: Capsule())
      }
      Button(intent: EndFlowSessionIntent()) {
        Label("End", systemImage: "xmark")
          .font(.system(size: 12, weight: .semibold))
          .padding(.horizontal, 12).padding(.vertical, 7)
      }
      .buttonStyle(.plain)
      .foregroundStyle(Ink.pale)
      .background(Ink.rule, in: Capsule())
    }
  }
}
