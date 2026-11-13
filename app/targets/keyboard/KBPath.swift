import CoreGraphics
import Foundation

/// THE `path` MARK SHAPE, on a key.
///
/// A key print can be a drawing, and this is the one new shape in this build:
/// `rect`, `line`, `circle` and `bars` already ship on the mic key
/// (`TulmiMarkView.parse`). `path` adds the grammar nlook, the bots' looks
/// and the animation format all share — `M L Q C Z O` — so a path drawn for
/// an animation scene is drawable as a widget shape or a key print without a
/// second build.
///
/// It is DATA, not code. Six commands, numbers only, no expressions. An
/// unknown command, a wrong count of numbers or a token that is not a number
/// drops that one path and nothing else — never the mark, never the key,
/// never the keyboard (App Review 2.5.2, and the spec's "unknown degrades").
enum KBPath {

  /// A path is 900 characters at most, and one mark holds at most 12 of them.
  /// On Android each path becomes an alpha-mask bitmap, so a path is not free.
  static let maxDChars = 900
  static let maxPathsPerShape = 12

  /// Where an artboard lands inside `size`, the same way the mic key's mark
  /// is fitted: a round key fits its artboard by the DIAGONAL so no corner is
  /// cut off at the rim; `box` fits the sides instead. This is the keyboard's
  /// own framing and deliberately sits OUTSIDE the shared region below — the
  /// parser turns a string into numbers and never knows what it is drawing.
  static func fit(_ viewBox: CGRect, in size: CGSize, circle: Bool) -> (scale: CGFloat, origin: CGPoint) {
    let s = circle
      ? min(size.width, size.height) / max(1e-6, hypot(viewBox.width, viewBox.height))
      : min(size.width / max(1e-6, viewBox.width), size.height / max(1e-6, viewBox.height))
    return (s, CGPoint(x: (size.width - viewBox.width * s) / 2 - viewBox.minX * s,
                       y: (size.height - viewBox.height * s) / 2 - viewBox.minY * s))
  }

  /// THE MIDDLE OF A PATH, in its own viewBox units — the centre of the box
  /// around every point the grammar names.
  ///
  /// The mark's dispersal needs one point per shape to fly from, and every
  /// other kind has an obvious one: a rect's centre, a circle's centre, a
  /// line's midpoint. Without this a path would fall to the line branch,
  /// read `x1`/`y1`/`x2`/`y2` that a path does not have, and fly from the
  /// artboard's top-left corner. `layoutSubviews` already centres a path's
  /// layer on this same box, so the two agree.
  ///
  /// nil when the `d` is not drawable — then the shape has no layer either,
  /// and the caller falls back as it did before.
  ///
  /// A control point counts: an off-curve handle still pulls the drawing
  /// toward it, and the box around the handles is within a few units of the
  /// box around the curve. The dispersal only needs a direction to leave in.
  static func centre(_ d: String) -> CGPoint? {
    guard let ops = nlookParsePath(d, limit: maxDChars) else { return nil }
    var minX = CGFloat.greatestFiniteMagnitude, minY = CGFloat.greatestFiniteMagnitude
    var maxX = -CGFloat.greatestFiniteMagnitude, maxY = -CGFloat.greatestFiniteMagnitude
    func add(_ x: CGFloat, _ y: CGFloat) {
      minX = min(minX, x); maxX = max(maxX, x)
      minY = min(minY, y); maxY = max(maxY, y)
    }
    for op in ops {
      switch op {
      case .move(let x, let y): add(x, y)
      case .line(let x, let y): add(x, y)
      case .quad(let cx, let cy, let x, let y): add(cx, cy); add(x, y)
      case .cubic(let ax, let ay, let bx, let by, let x, let y): add(ax, ay); add(bx, by); add(x, y)
      case .circle(let cx, let cy, let r): add(cx - r, cy - r); add(cx + r, cy + r)
      case .close: break
      }
    }
    // `Z` alone, or a `d` of nothing but closes: no point was named.
    guard minX <= maxX, minY <= maxY else { return nil }
    // Not clamped: `step` places the layer at this point when at rest, and
    // `layoutSubviews` centred the layer on this same unclamped box. Holding
    // it inside the artboard would move the drawing — a shape whose box
    // centre lies outside would jump on the first frame of the dispersal and
    // come home to the wrong place. An off-artboard centre only changes the
    // direction a part leaves in, which is correct either way. Android's
    // `KbPath.centre` returns the same unclamped point.
    return CGPoint(x: (minX + maxX) / 2, y: (minY + maxY) / 2)
  }

  /// A `d` string, parsed in its own viewBox units and placed into `size`.
  /// nil when the path is not drawable — the caller leaves that shape empty
  /// and the rest of the mark still draws.
  static func path(_ d: String, viewBox: CGRect, in size: CGSize, circle: Bool) -> CGPath? {
    guard let ops = nlookParsePath(d, limit: maxDChars) else { return nil }
    let (s, o) = fit(viewBox, in: size, circle: circle)
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: o.x + x * s, y: o.y + y * s) }
    let out = CGMutablePath()
    var started = false
    for op in ops {
      switch op {
      case .move(let x, let y):
        out.move(to: pt(x, y))
        started = true
      case .line(let x, let y):
        if !started { out.move(to: pt(x, y)); started = true } else { out.addLine(to: pt(x, y)) }
      case .quad(let cx, let cy, let x, let y):
        if !started { out.move(to: pt(cx, cy)); started = true }
        out.addQuadCurve(to: pt(x, y), control: pt(cx, cy))
      case .cubic(let c1x, let c1y, let c2x, let c2y, let x, let y):
        if !started { out.move(to: pt(c1x, c1y)); started = true }
        out.addCurve(to: pt(x, y), control1: pt(c1x, c1y), control2: pt(c2x, c2y))
      case .close:
        out.closeSubpath()
      case .circle(let cx, let cy, let r):
        let c = pt(cx, cy)
        out.addEllipse(in: CGRect(x: c.x - r * s, y: c.y - r * s, width: r * s * 2, height: r * s * 2))
        started = true
      }
    }
    return out.isEmpty ? nil : out
  }
}

// The region below is byte-identical with the widget extension's copy in
// app/targets/widgets/NLookPath.swift, and `node tools/ci/marked-regions.mjs`
// diffs the two. IOS-WIDGETS holds the pen on that copy, IOS-KEYBOARD on this
// one; neither edits the other's, and a change lands in both at once. Nothing
// inside the markers may import UIKit, name a colour, or know what it is
// drawing: it turns a string into numbers and nothing else.

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
