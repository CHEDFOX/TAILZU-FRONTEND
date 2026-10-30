import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// THE MICROPHONE SESSION, AS A LIVE ACTIVITY. The app holds the microphone
// in the background so the keyboard can dictate; this is where that is
// visible — on the Lock Screen and in the Dynamic Island — and where it can be
// stopped. Ready between dictations, listening with the words so far, writing
// after. The words are a count: what was said never appears here.
//
// It names the app: the mark and "X0" head the Lock Screen banner and the
// expanded island. The banner is the palette's ground with ink words, Light or
// Dark as the phone is; the island is always black, so white words. The
// expanded island keeps the camera's sides for the name and the buttons, and
// puts the phase and its hint below them, where nothing is cut.
//
// The attributes and the End button's intent live in _shared/FlowEnd.swift,
// which is built into the app too, so End works even when the app is not
// listening. The attributes are declared once more, byte for byte, in the
// app's bridge module (FlowLiveActivity.swift). ActivityKit matches them by
// the type's name and its encoding, so the copies must stay identical.
//
// The words (and the symbols) are the server's: the app writes them to the
// App Group as "tulmi.widget.flow.copy" (setFlowActivityCopy, from the
// widget.flow.* labels), and each one read here falls back to a word of its
// own. The colours are the app's (X0Palette); the copy's old per-phase accents
// are no longer read.

/// The activity's words, as the app last wrote them.
enum FlowCopy {
  static func text(_ key: String, _ fallback: String) -> String {
    guard let s = object()?[key] as? String, !s.isEmpty else { return fallback }
    return s
  }

  /// A word with its `{n}` filled in.
  static func text(_ key: String, _ fallback: String, n value: String) -> String {
    text(key, fallback).replacingOccurrences(of: "{n}", with: value)
  }

  /// The copy object the app last wrote.
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
}

/// The phase as one of the three the session has; anything else reads as ready.
private func phaseOf(_ raw: String) -> String {
  raw == "listening" || raw == "writing" ? raw : "ready"
}

func phaseWord(_ phase: String) -> String {
  switch phaseOf(phase) {
  case "listening": return FlowCopy.text("listening", "Listening")
  case "writing": return FlowCopy.text("writing", "Writing")
  default: return FlowCopy.text("ready", "Mic on")
  }
}

/// The phase's symbol: the mic while ready, a live waveform while listening,
/// the pencil while writing.
func phaseSymbol(_ phase: String) -> String {
  switch phaseOf(phase) {
  case "listening": return symbol(FlowCopy.text("iconListening", "waveform"), "waveform")
  case "writing": return symbol(FlowCopy.text("iconWriting", "pencil"), "pencil")
  default: return symbol(FlowCopy.text("iconIdle", "mic"), "mic")
  }
}

/// Stop runs in this extension and reaches the app the way the keyboard does:
/// a Darwin notification the session already listens for. It is only shown
/// while listening, when the app is running. (End runs in the app itself —
/// see _shared/FlowEnd.swift.)
private func nudge(_ name: String) {
  CFNotificationCenterPostNotification(
    CFNotificationCenterGetDarwinNotifyCenter(),
    CFNotificationName(name as CFString), nil, nil, true)
}

struct StopDictationIntent: AppIntent {
  static let title: LocalizedStringResource = "Stop dictating"
  static let description = IntentDescription("Finishes the sentence being dictated to X0.")
  /// The Live Activity's Stop button, not an action of its own in Shortcuts.
  static var isDiscoverable: Bool { false }

  func perform() async throws -> some IntentResult {
    nudge("space.tailzu.tulmi.flow.stop")
    return .result()
  }
}

struct FlowActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: FlowActivityAttributes.self) { context in
      FlowLockScreen(state: context.state)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          X0Brand(p: .dark, size: 24)
            .padding(.leading, 6)
        }
        DynamicIslandExpandedRegion(.trailing) {
          FlowButtons(phase: context.state.phase, p: .dark)
            .padding(.trailing, 4)
            .dynamicIsland(verticalPlacement: .belowIfTooWide)
        }
        DynamicIslandExpandedRegion(.bottom) {
          FlowTitle(state: context.state, p: .dark)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
            .padding(.top, 4)
        }
      } compactLeading: {
        FlowCompactLeading(phase: context.state.phase)
      } compactTrailing: {
        FlowCompactTrailing(state: context.state)
      } minimal: {
        FlowCompactLeading(phase: context.state.phase)
      }
      .keylineTint(X0Palette.dark.dim)
    }
  }
}

/// The Lock Screen's banner, in the phone's own appearance.
struct FlowLockScreen: View {
  @Environment(\.colorScheme) private var scheme
  let state: FlowActivityAttributes.ContentState

  var body: some View {
    let p = X0Palette.of(scheme)
    FlowBanner(state: state, p: p)
      .activityBackgroundTint(p.ground)
      .activitySystemActionForegroundColor(p.ink)
  }
}

/// The phase, with its symbol, and under it the count (or, when ready, the
/// server's hint — none unless it sends one).
struct FlowTitle: View {
  let state: FlowActivityAttributes.ContentState
  let p: X0Palette

  private var detail: String {
    if phaseOf(state.phase) == "ready" { return FlowCopy.text("readyHint", "") }
    // The running count, unless the server hides it (readyHint is not a count).
    if !FlowCopy.flag("showWords", true) { return "" }
    return FlowCopy.text("words", "{n} words", n: n(state.words))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Image(systemName: phaseSymbol(state.phase))
          .font(.system(size: 13, weight: .semibold))
        Text(phaseWord(state.phase))
          .font(.system(size: 16, weight: .semibold))
          .tracking(-0.3)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .foregroundStyle(p.ink)
      if !detail.isEmpty {
        Text(detail)
          .font(.system(size: 13))
          .monospacedDigit()
          .foregroundStyle(p.meta)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

/// The Lock Screen banner: the mark and the name, the phase, the buttons.
struct FlowBanner: View {
  let state: FlowActivityAttributes.ContentState
  let p: X0Palette

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 10) {
        X0Brand(p: p)
        FlowTitle(state: state, p: p)
      }
      Spacer(minLength: 8)
      FlowButtons(phase: state.phase, p: p)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
  }
}

/// Stop the sentence while listening (the primary: filled with ink); end the
/// session (the secondary: a line-coloured ring). Round, symbol only (the word
/// stays for VoiceOver).
struct FlowButtons: View {
  let phase: String
  let p: X0Palette

  var body: some View {
    HStack(spacing: 8) {
      if phaseOf(phase) == "listening" {
        Button(intent: StopDictationIntent()) {
          Label(FlowCopy.text("stop", "Stop"), systemImage: symbol(FlowCopy.text("iconStop", "stop.fill"), "stop.fill"))
            .labelStyle(.iconOnly)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(p.ground)
            .frame(width: 36, height: 36)
            .background { Circle().fill(p.ink) }
        }
        .buttonStyle(.plain)
      }
      // The End button shows unless the server hides it.
      if FlowCopy.flag("showEnd", true) {
        Button(intent: EndFlowSessionIntent()) {
          Label(FlowCopy.text("end", "End"), systemImage: symbol(FlowCopy.text("iconEnd", "xmark"), "xmark"))
            .labelStyle(.iconOnly)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(p.ink)
            .frame(width: 36, height: 36)
            .background { Circle().strokeBorder(p.line, lineWidth: 1) }
        }
        .buttonStyle(.plain)
      }
    }
  }
}

/// The island's compact left (and its minimal): the mark while ready, the
/// phase's symbol while it listens or writes.
struct FlowCompactLeading: View {
  let phase: String

  var body: some View {
    if phaseOf(phase) == "ready" {
      X0Mark(size: 22, onDark: true)
    } else {
      Image(systemName: phaseSymbol(phase))
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(X0Palette.dark.ink)
    }
  }
}

/// The island's compact right: the running count while listening (or a
/// short word, when the server hides it), "Writing" while writing, the ready
/// word while ready.
struct FlowCompactTrailing: View {
  let state: FlowActivityAttributes.ContentState

  private var word: String {
    switch phaseOf(state.phase) {
    case "listening":
      return FlowCopy.flag("showWords", true) ? String(state.words) : FlowCopy.text("compactListening", "Live")
    case "writing":
      return FlowCopy.text("compactWriting", "Writing")
    default:
      return FlowCopy.text("compact", x0Name)
    }
  }

  var body: some View {
    Text(word)
      .font(.system(size: 13, weight: .semibold))
      .monospacedDigit()
      .foregroundStyle(X0Palette.dark.ink)
      .lineLimit(1)
  }
}
