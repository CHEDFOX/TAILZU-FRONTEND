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
// The attributes and the End button's intent live in _shared/FlowEnd.swift,
// which is built into the app too, so End works even when the app is not
// listening. The attributes are declared once more, byte for byte, in the
// app's bridge module (FlowLiveActivity.swift). ActivityKit matches them by
// the type's name and its encoding, so the copies must stay identical.
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

  /// The copy object the app last wrote, for the non-string keys below.
  private static func object() -> [String: Any]? {
    guard let raw = Shared.store?.string(forKey: "tulmi.widget.flow.copy"),
          let data = raw.data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { return nil }
    return o
  }

  /// A switch the server sent (showWords / showEnd), or the default.
  static func flag(_ key: String, _ fallback: Bool) -> Bool {
    guard let v = object()?[key] else { return fallback }
    if let b = v as? Bool { return b }
    if let num = v as? NSNumber { return num.boolValue }
    return fallback
  }

  /// A per-phase accent the server sent (accent*), or the ink it replaces.
  static func color(_ key: String, _ fallback: Color) -> Color {
    guard let s = object()?[key] as? String, let c = Color(hex: s) else { return fallback }
    return c
  }
}

/// The accent for a phase: the server's per-phase colour when it sent one
/// (accentListening / accentWriting / accentReady in the copy payload), else
/// the ink mark it would otherwise use.
func flowAccent(_ phase: String) -> Color {
  switch phase {
  case "listening": return FlowCopy.color("accentListening", Ink.mark)
  case "writing": return FlowCopy.color("accentWriting", Ink.mark)
  default: return FlowCopy.color("accentReady", Ink.mark)
  }
}

/// Stop runs in this extension and reaches the app the way the keyboard does:
/// a Darwin notification the Flow session already listens for. It is only
/// shown while listening, when the app is running. (End runs in the app
/// itself — see _shared/FlowEnd.swift.)
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
          .foregroundStyle(context.state.phase == "listening" ? flowAccent("listening") : Ink.dim)
      } compactTrailing: {
        // The running count, unless the server hides it — then the ready word.
        Text(context.state.phase == "listening" && FlowCopy.flag("showWords", true)
             ? String(context.state.words)
             : FlowCopy.text("compact", "Flow"))
          .font(.system(size: 12, weight: .medium, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(Ink.dim)
      } minimal: {
        Image(systemName: FlowCopy.text("iconMinimal", "waveform")).foregroundStyle(flowAccent(context.state.phase))
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
    if state.phase == "ready" { return FlowCopy.text("readyHint", "") }
    // The running count, unless the server hides it (readyHint is not a count).
    if !FlowCopy.flag("showWords", true) { return "" }
    return FlowCopy.text("words", "{n} words", n: n(state.words))
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
      WaveMark(color: state.phase == "listening" ? flowAccent("listening") : Ink.dim).frame(width: 26, height: 18)
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
      // The End button shows unless the server hides it.
      if FlowCopy.flag("showEnd", true) {
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
}
