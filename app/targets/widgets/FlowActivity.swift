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
          Text(FlowCopy.text("words", "{n} words", n: n(context.state.words)))
            .font(.system(size: 13, weight: .medium, design: .rounded))
            .foregroundStyle(Ink.dim)
        }
        DynamicIslandExpandedRegion(.bottom) {
          FlowButtons(phase: context.state.phase)
        }
      } compactLeading: {
        Image(systemName: context.state.phase == "listening"
              ? FlowCopy.text("iconListening", "waveform")
              : FlowCopy.text("iconIdle", "mic"))
          .foregroundStyle(Ink.amber)
      } compactTrailing: {
        Text(context.state.phase == "listening"
             ? String(context.state.words)
             : FlowCopy.text("compact", "Flow"))
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .foregroundStyle(Ink.pale)
      } minimal: {
        Image(systemName: FlowCopy.text("iconMinimal", "waveform")).foregroundStyle(Ink.amber)
      }
      .keylineTint(Ink.amber)
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

/// The Lock Screen banner.
struct FlowBanner: View {
  let state: FlowActivityAttributes.ContentState
  var body: some View {
    HStack(spacing: 14) {
      WaveMark(color: state.phase == "listening" ? Ink.amber : Ink.dim).frame(width: 34, height: 24)
      VStack(alignment: .leading, spacing: 2) {
        Text(phaseWord(state.phase)).font(.system(size: 15, weight: .semibold)).foregroundStyle(Ink.pale)
        Text(state.phase == "ready"
             ? FlowCopy.text("readyHint", "Tap the mic on the keyboard to dictate.")
             : FlowCopy.text("wordsSoFar", "{n} words so far.", n: n(state.words)))
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
          Label(FlowCopy.text("stop", "Stop"), systemImage: FlowCopy.text("iconStop", "stop.fill"))
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 12).padding(.vertical, 7)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Ink.ground)
        .background(Ink.amber, in: Capsule())
      }
      Button(intent: EndFlowSessionIntent()) {
        Label(FlowCopy.text("end", "End"), systemImage: FlowCopy.text("iconEnd", "xmark"))
          .font(.system(size: 12, weight: .semibold))
          .padding(.horizontal, 12).padding(.vertical, 7)
      }
      .buttonStyle(.plain)
      .foregroundStyle(Ink.pale)
      .background(Ink.rule, in: Capsule())
    }
  }
}
