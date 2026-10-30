import ActivityKit
import SwiftUI
import WidgetKit

// SETUP, AS A LIVE ACTIVITY: the step someone left off at, on the Lock Screen
// and in the Dynamic Island, until setup is done. The steps already behind
// them are drawn filled, so what is left reads as short — which it is. Every
// word is the server's (the bootstrap's `liveActivity.setup`); a tap goes back
// into the app at that step.
//
// It names the app: the mark and "X0" head the Lock Screen banner and the
// expanded island. The banner is the palette's ground with ink words, Light or
// Dark as the phone is; the island is always black, so white words. Progress
// is ink on the line colour.
//
// The attributes are declared once more, byte for byte, in the app's bridge
// module (SetupLiveActivity.swift). ActivityKit matches the two by the type's
// name and its encoding, so the two copies must stay identical.

struct SetupActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// Steps done, and how many there are.
    var done: Int
    var total: Int
    /// What to do next, and what it takes — the server's words.
    var title: String
    var detail: String
    /// Where a tap lands ("tulmi://screen/<id>").
    var url: String
  }
  var startedAt: Date
}

struct SetupActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SetupActivityAttributes.self) { context in
      SetupLockScreen(state: context.state)
        .widgetURL(URL(string: context.state.url))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          X0Brand(p: .dark, size: 24)
            .padding(.leading, 6)
        }
        DynamicIslandExpandedRegion(.trailing) {
          SetupCount(state: context.state, p: .dark)
            .padding(.trailing, 6)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
              SetupTitle(state: context.state, p: .dark)
              Spacer(minLength: 8)
              SetupChevron(p: .dark)
            }
            SetupSegments(state: context.state, p: .dark)
          }
          .padding(.horizontal, 6)
          .padding(.top, 4)
        }
      } compactLeading: {
        X0Mark(size: 22, onDark: true)
      } compactTrailing: {
        SetupRing(state: context.state, p: .dark).frame(width: 16, height: 16)
      } minimal: {
        SetupRing(state: context.state, p: .dark).frame(width: 16, height: 16)
      }
      .widgetURL(URL(string: context.state.url))
      .keylineTint(X0Palette.dark.dim)
    }
  }
}

/// The Lock Screen's banner, in the phone's own appearance.
struct SetupLockScreen: View {
  @Environment(\.colorScheme) private var scheme
  let state: SetupActivityAttributes.ContentState

  var body: some View {
    let p = X0Palette.of(scheme)
    SetupBanner(state: state, p: p)
      .activityBackgroundTint(p.ground)
      .activitySystemActionForegroundColor(p.ink)
  }
}

/// The step, and under it what it takes.
struct SetupTitle: View {
  let state: SetupActivityAttributes.ContentState
  let p: X0Palette
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(state.title)
        .font(.system(size: 16, weight: .semibold))
        .tracking(-0.3)
        .foregroundStyle(p.ink)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      if !state.detail.isEmpty {
        Text(state.detail)
          .font(.system(size: 13))
          .foregroundStyle(p.meta)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

/// Where a tap goes: on into the app.
struct SetupChevron: View {
  let p: X0Palette
  var body: some View {
    Image(systemName: "chevron.right")
      .font(.system(size: 13, weight: .semibold))
      .foregroundStyle(p.meta)
  }
}

/// How far along: "1/3" and the ring.
struct SetupCount: View {
  let state: SetupActivityAttributes.ContentState
  let p: X0Palette
  var body: some View {
    HStack(spacing: 6) {
      Text("\(state.done)/\(state.total)")
        .font(.system(size: 13, weight: .medium))
        .monospacedDigit()
        .foregroundStyle(p.meta)
      SetupRing(state: state, p: p).frame(width: 18, height: 18)
    }
  }
}

/// One segment per step, the finished ones filled with ink.
struct SetupSegments: View {
  let state: SetupActivityAttributes.ContentState
  let p: X0Palette
  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<max(1, state.total), id: \.self) { i in
        Capsule()
          .fill(i < state.done ? p.ink : p.line)
          .frame(height: 4)
      }
    }
  }
}

/// The same progress, round: ink on the line colour.
struct SetupRing: View {
  let state: SetupActivityAttributes.ContentState
  let p: X0Palette
  private var progress: Double { min(1, max(0, Double(state.done) / Double(max(1, state.total)))) }
  var body: some View {
    ZStack {
      Circle().stroke(p.line, lineWidth: 2.5)
      Circle()
        .trim(from: 0, to: progress)
        .stroke(p.ink, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        .rotationEffect(.degrees(-90))
    }
  }
}

/// The Lock Screen banner: the mark and the name with how far along, the step
/// and what it takes, the steps as segments.
struct SetupBanner: View {
  let state: SetupActivityAttributes.ContentState
  let p: X0Palette
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .center, spacing: 8) {
        X0Brand(p: p)
        Spacer(minLength: 8)
        Text("\(state.done)/\(state.total)")
          .font(.system(size: 13, weight: .medium))
          .monospacedDigit()
          .foregroundStyle(p.meta)
      }
      HStack(alignment: .center, spacing: 12) {
        SetupTitle(state: state, p: p)
        Spacer(minLength: 8)
        SetupChevron(p: p)
      }
      SetupSegments(state: state, p: p)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
  }
}
