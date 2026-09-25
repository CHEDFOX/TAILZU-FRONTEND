import SwiftUI
import WidgetKit

// THE WIDGETS. One extension, three things: the month on the Home and Lock
// Screen, the Flow session as a Live Activity, and Dictate as a Control.
// Everything they show comes from the App Group the app writes; nothing here
// talks to the server, and no dictated text is ever drawn — a widget sits on
// a Lock Screen.

@main
struct TailzuWidgetBundle: WidgetBundle {
  var body: some Widget {
    MonthWidget()
    FlowActivityWidget()
    if #available(iOS 18.0, *) {
      DictateControl()
    }
  }
}

/// The app's own colours, as STATS_UI in the backend's catalog has them.
enum Ink {
  static let ground = Color(red: 0x0F / 255, green: 0x0D / 255, blue: 0x0B / 255)
  static let pale = Color(red: 0xF3 / 255, green: 0xE2 / 255, blue: 0xC6 / 255)
  static let amber = Color(red: 0xE8 / 255, green: 0xA2 / 255, blue: 0x3C / 255)
  static let dim = pale.opacity(0.52)
  static let rule = pale.opacity(0.13)
}

enum Shared {
  static let appGroup = "group.com.tulmi.app"
  static var store: UserDefaults? { UserDefaults(suiteName: appGroup) }
}

/// THE WAVE OF THE MARK: the seven bars of uneven height from the app icon,
/// as the keyboard's mic key draws them. Drawn, not an image, so it is the
/// same shape at every size and in every colour.
struct WaveMark: View {
  var color: Color = Ink.amber
  private let heights: [CGFloat] = [28, 36, 41, 46, 43, 34, 28]
  var body: some View {
    GeometryReader { geo in
      let n = CGFloat(heights.count)
      let gap = geo.size.width / (n * 2 - 1)
      let unit = geo.size.height / 46
      HStack(alignment: .center, spacing: gap) {
        ForEach(0..<heights.count, id: \.self) { i in
          RoundedRectangle(cornerRadius: gap * 0.5, style: .continuous)
            .fill(color)
            .frame(width: gap, height: heights[i] * unit)
        }
      }
      .frame(width: geo.size.width, height: geo.size.height)
    }
  }
}

/// A count as the app prints it: "4,820".
func n(_ value: Int) -> String {
  let f = NumberFormatter()
  f.numberStyle = .decimal
  return f.string(from: NSNumber(value: value)) ?? String(value)
}
