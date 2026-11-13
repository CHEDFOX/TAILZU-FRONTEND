import CoreGraphics
import SwiftUI

// THE PATH GRAMMAR, SHARED WITH THE KEYBOARD AND THE BOTS' LOOKS: `M L Q C Z O`.
//
// `C` is the animation format's cubic and `O` is a circle (cx cy r). Every native parser accepts this superset from day one,
// so a path drawn for an animation scene stays drawable as a widget shape or a key print, and a still of any moment can be
// handed to either side.
//
// The region between the BEGIN and END markers below is kept BYTE-IDENTICAL with targets/keyboard/KBPath.swift's core; CI
// diffs the two. IOS-WIDGETS holds the pen on this copy, IOS-KEYBOARD on the keyboard's. Nothing inside the markers may
// import SwiftUI, name a palette, or know what it is drawing — it turns a string into numbers and nothing else.

// BEGIN NLookPathCore
/// One command of a path, already turned into numbers. An unknown letter never becomes one of these.
enum NLookPathOp {
  /// Move to (x, y).
  case move(CGFloat, CGFloat)
  /// Line to (x, y).
  case line(CGFloat, CGFloat)
  /// Quadratic to (x, y) with control (cx, cy).
  case quad(CGFloat, CGFloat, CGFloat, CGFloat)
  /// Cubic to (x, y) with controls (c1x, c1y) and (c2x, c2y).
  case cubic(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)
  /// Close the current subpath.
  case close
  /// A whole circle: centre (cx, cy), radius r.
  case circle(CGFloat, CGFloat, CGFloat)
}

/// Turn one `d` string into commands. Returns nothing at all when any part of it is not this grammar: a half-drawn shape is
/// worse than no shape, and the node's fallback takes over.
///
/// Numbers are separated by spaces or commas. An unknown letter, a short argument list or a number that is not finite drops
/// the WHOLE path, not just that command.
func nlookParsePath(_ d: String, limit: Int = 900) -> [NLookPathOp]? {
  guard !d.isEmpty, d.count <= limit else { return nil }
  var ops: [NLookPathOp] = []
  var numbers: [CGFloat] = []
  var letter: Character?

  func flush() -> Bool {
    guard let l = letter else { return numbers.isEmpty }
    switch l {
    case "M":
      guard numbers.count == 2 else { return false }
      ops.append(.move(numbers[0], numbers[1]))
    case "L":
      guard numbers.count == 2 else { return false }
      ops.append(.line(numbers[0], numbers[1]))
    case "Q":
      guard numbers.count == 4 else { return false }
      ops.append(.quad(numbers[0], numbers[1], numbers[2], numbers[3]))
    case "C":
      guard numbers.count == 6 else { return false }
      ops.append(.cubic(numbers[0], numbers[1], numbers[2], numbers[3], numbers[4], numbers[5]))
    case "Z":
      guard numbers.isEmpty else { return false }
      ops.append(.close)
    case "O":
      guard numbers.count == 3, numbers[2] > 0 else { return false }
      ops.append(.circle(numbers[0], numbers[1], numbers[2]))
    default:
      return false
    }
    numbers.removeAll(keepingCapacity: true)
    return true
  }

  var token = ""
  func takeNumber() -> Bool {
    guard !token.isEmpty else { return true }
    guard let v = Double(token), v.isFinite, abs(v) < 100_000 else { return false }
    numbers.append(CGFloat(v))
    token = ""
    return true
  }

  for ch in d {
    if ch == "M" || ch == "L" || ch == "Q" || ch == "C" || ch == "Z" || ch == "O" {
      guard takeNumber(), flush() else { return nil }
      letter = ch
    } else if ch == " " || ch == "," || ch == "\n" || ch == "\t" {
      guard takeNumber() else { return nil }
    } else if ch.isNumber || ch == "." || ch == "-" || ch == "+" || ch == "e" || ch == "E" {
      token.append(ch)
      guard token.count <= 24 else { return nil }
    } else {
      // Any other letter is a command this grammar does not have (an arc, a relative move): drop the path.
      return nil
    }
  }
  guard takeNumber(), flush() else { return nil }
  guard !ops.isEmpty, ops.count <= 400 else { return nil }
  return ops
}
// END NLookPathCore

extension Path {
  /// The commands drawn into a box, scaled from the design's own `viewBox` so a path written at 120 x 24 fits any frame.
  init?(nlook d: String, viewBox: CGSize, in rect: CGRect) {
    guard viewBox.width > 0, viewBox.height > 0, let ops = nlookParsePath(d, limit: NLookLimits.dChars) else { return nil }
    // One scale for both axes, so nothing is squashed; the drawing is centred in whatever is left over.
    let s = min(rect.width / viewBox.width, rect.height / viewBox.height)
    let dx = rect.minX + (rect.width - viewBox.width * s) / 2
    let dy = rect.minY + (rect.height - viewBox.height * s) / 2
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: dx + x * s, y: dy + y * s) }

    var path = Path()
    for op in ops {
      switch op {
      case .move(let x, let y):
        path.move(to: pt(x, y))
      case .line(let x, let y):
        if path.isEmpty { path.move(to: pt(x, y)) } else { path.addLine(to: pt(x, y)) }
      case .quad(let cx, let cy, let x, let y):
        if path.isEmpty { path.move(to: pt(cx, cy)) }
        path.addQuadCurve(to: pt(x, y), control: pt(cx, cy))
      case .cubic(let c1x, let c1y, let c2x, let c2y, let x, let y):
        if path.isEmpty { path.move(to: pt(c1x, c1y)) }
        path.addCurve(to: pt(x, y), control1: pt(c1x, c1y), control2: pt(c2x, c2y))
      case .close:
        path.closeSubpath()
      case .circle(let cx, let cy, let r):
        let c = pt(cx, cy)
        path.addEllipse(in: CGRect(x: c.x - r * s, y: c.y - r * s, width: r * s * 2, height: r * s * 2))
      }
    }
    guard !path.isEmpty else { return nil }
    self = path
  }
}
