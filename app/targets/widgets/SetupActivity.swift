import ActivityKit
import SwiftUI
import WidgetKit

// SETUP, AS A LIVE ACTIVITY: the step someone left off at, on the Lock Screen
// and in the Dynamic Island, until setup is done. The steps already behind
// them are drawn filled, so what is left reads as short — which it is. Every
// word is the server's (the bootstrap's `liveActivity.setup`); a tap goes back
// into the app at that step.
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
      SetupBanner(state: context.state)
        .activityBackgroundTint(Ink.ground)
        .activitySystemActionForegroundColor(Ink.pale)
        .widgetURL(URL(string: context.state.url))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          SetupRing(state: context.state).frame(width: 30, height: 30).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          SetupTitle(state: context.state)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Image(systemName: "chevron.right")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Ink.dim)
            .padding(.trailing, 4)
        }
      } compactLeading: {
        SetupRing(state: context.state).frame(width: 16, height: 16)
      } compactTrailing: {
        Text("\(context.state.done)/\(context.state.total)")
          .font(.system(size: 12, weight: .medium, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(Ink.dim)
      } minimal: {
        SetupRing(state: context.state).frame(width: 16, height: 16)
      }
      .widgetURL(URL(string: context.state.url))
      .keylineTint(Ink.dim)
    }
  }
}

/// The step, and under it what it takes.
struct SetupTitle: View {
  let state: SetupActivityAttributes.ContentState
  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(state.title)
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(Ink.pale)
        .lineLimit(1)
      if !state.detail.isEmpty {
        Text(state.detail)
          .font(.system(size: 12))
          .foregroundStyle(Ink.dim)
          .lineLimit(2)
      }
    }
  }
}

/// One segment per step, the finished ones filled.
struct SetupSegments: View {
  let state: SetupActivityAttributes.ContentState
  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<max(1, state.total), id: \.self) { i in
        Capsule()
          .fill(i < state.done ? Ink.pale : Ink.rule)
          .frame(height: 3)
      }
    }
  }
}

/// The same progress, round, for the Dynamic Island.
struct SetupRing: View {
  let state: SetupActivityAttributes.ContentState
  private var progress: Double { Double(state.done) / Double(max(1, state.total)) }
  var body: some View {
    ZStack {
      Circle().stroke(Ink.rule, lineWidth: 2.5)
      Circle()
        .trim(from: 0, to: progress)
        .stroke(Ink.pale, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        .rotationEffect(.degrees(-90))
    }
  }
}

/// The Lock Screen banner: the step, what it takes, the steps as segments.
struct SetupBanner: View {
  let state: SetupActivityAttributes.ContentState
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .center, spacing: 12) {
        SetupTitle(state: state)
        Spacer(minLength: 8)
        Image(systemName: "chevron.right")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(Ink.dim)
      }
      SetupSegments(state: state)
    }
    .padding(16)
  }
}
