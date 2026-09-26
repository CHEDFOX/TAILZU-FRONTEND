// UIKit, as far as the keyboard's touch path reaches into it — nothing more.
//
// The keyboard's own classes (KeyPlaneView, KeyRowStackView, KeyHitButton)
// and the renderer functions on the keystroke path are compiled VERBATIM from
// SDUIRenderer.swift against this file (see gen.py). What lives here is the
// part of iOS they lean on, modelled on UIKit's documented and observed
// behaviour:
//
//   • views, frames, convert(), and hit-testing that skips hidden, faded and
//     non-interactive views and only descends into a subview when the point is
//     inside its parent — the rule the plane's obstacle clipping relies on;
//   • UIControl events: touchDown, then touchUpInside when the finger lifts
//     within 70pt of the control (UIKit's drag tolerance), touchUpOutside
//     beyond it, touchCancel when a gesture takes the touch;
//   • a virtual clock: CACurrentMediaTime, Timer and RunLoop run on simulated
//     time, so a run is deterministic and a second of typing takes microseconds.
//
// Drawing, layers and animation are inert stand-ins; nothing in the touch path
// reads them back.
import Foundation

// MARK: - Clock and timers

enum Clock { static var now: Double = 0 }
func CACurrentMediaTime() -> Double { Clock.now }

final class Timer {
  let fireAt: Double
  let block: (Timer) -> Void
  private(set) var isValid = true
  let seq: Int
  private static var nextSeq = 0
  init(timeInterval: Double, repeats: Bool, block: @escaping (Timer) -> Void) {
    fireAt = Clock.now + timeInterval
    self.block = block
    Timer.nextSeq += 1
    seq = Timer.nextSeq
  }
  func invalidate() { isValid = false }
}

final class RunLoop {
  static let main = RunLoop()
  struct Mode: Hashable { let raw: String
    static let common = Mode(raw: "common"); static let `default` = Mode(raw: "default") }
  var pending: [Timer] = []
  func add(_ t: Timer, forMode: Mode) { pending.append(t) }
  /// Fire every valid timer due at or before `t`, in time order, advancing the
  /// clock to each one's moment.
  func run(until t: Double) {
    while true {
      pending.removeAll { !$0.isValid }
      guard let next = pending.filter({ $0.fireAt <= t })
        .min(by: { ($0.fireAt, $0.seq) < ($1.fireAt, $1.seq) }) else { break }
      pending.removeAll { $0 === next }
      if next.fireAt > Clock.now { Clock.now = next.fireAt }
      next.invalidate()
      next.block(next)
    }
  }
}

// MARK: - Geometry

struct UIEdgeInsets {
  var top: CGFloat, left: CGFloat, bottom: CGFloat, right: CGFloat
  static let zero = UIEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
}
extension CGRect {
  func inset(by i: UIEdgeInsets) -> CGRect {
    CGRect(x: minX + i.left, y: minY + i.top,
           width: width - i.left - i.right, height: height - i.top - i.bottom)
  }
}
struct CGVector { var dx: CGFloat; var dy: CGFloat }
extension CGRect { func equalTo(_ r: CGRect) -> Bool { self == r } }
typealias CFTimeInterval = Double

// MARK: - Inert drawing stand-ins

final class CGColor {}
final class CGPath {}
final class CGContext {
  func setFillColor(_ c: CGColor) {}
  func setStrokeColor(_ c: CGColor) {}
  func setLineWidth(_ w: CGFloat) {}
  func fill(_ r: CGRect) {}
  func stroke(_ r: CGRect) {}
}
func UIGraphicsGetCurrentContext() -> CGContext? { nil }

final class UIColor {
  let white: CGFloat, alpha: CGFloat
  init(white: CGFloat, alpha: CGFloat) { self.white = white; self.alpha = alpha }
  func withAlphaComponent(_ a: CGFloat) -> UIColor { UIColor(white: white, alpha: a) }
  var cgColor: CGColor { CGColor() }
  static let clear = UIColor(white: 0, alpha: 0)
  static let white = UIColor(white: 1, alpha: 1)
  static let black = UIColor(white: 0, alpha: 1)
  static let systemGreen = UIColor(white: 0.5, alpha: 1)
  static let systemRed = UIColor(white: 0.5, alpha: 1)
  static let systemOrange = UIColor(white: 0.5, alpha: 1)
  static let systemBlue = UIColor(white: 0.5, alpha: 1)
}
final class UIFont { static func systemFont(ofSize s: CGFloat) -> UIFont { UIFont() } }

class CAAnimation {}
final class CABasicAnimation: CAAnimation {
  var fromValue: Any?, toValue: Any?
  var duration: Double = 0
  var fillMode: CAMediaTimingFillMode = .removed
  var isRemovedOnCompletion = true
  init(keyPath: String) {}
}
enum CAMediaTimingFillMode { case removed, forwards }
enum CAShapeLayerLineCap { case butt, round }
enum CAShapeLayerLineJoin { case miter, round }
class CALayer {
  var sublayers: [CALayer] = []
  var opacity: Float = 1
  var cornerRadius: CGFloat = 0
  func addSublayer(_ l: CALayer) { sublayers.append(l) }
  func removeAnimation(forKey: String) {}
  func add(_ a: CAAnimation, forKey: String?) {}
}
final class CAShapeLayer: CALayer {
  var fillColor: CGColor?, strokeColor: CGColor?
  var lineWidth: CGFloat = 1
  var lineCap: CAShapeLayerLineCap = .butt
  var lineJoin: CAShapeLayerLineJoin = .miter
  var path: CGPath?
}
final class UIBezierPath {
  func move(to p: CGPoint) {}
  func addLine(to p: CGPoint) {}
  var cgPath: CGPath { CGPath() }
}

// MARK: - Views

class UIView: NSObject {
  var frame: CGRect
  var bounds: CGRect { CGRect(origin: .zero, size: frame.size) }
  weak var superview: UIView?
  private(set) var subviews: [UIView] = []
  var isHidden = false
  var alpha: CGFloat = 1
  var isUserInteractionEnabled = true
  var isMultipleTouchEnabled = false
  var backgroundColor: UIColor?
  var isOpaque = true
  var tintColor: UIColor?
  var accessibilityIdentifier: String?
  var translatesAutoresizingMaskIntoConstraints = true
  enum ContentMode { case scaleToFill, redraw, center, scaleAspectFill }
  var contentMode: ContentMode = .scaleToFill
  let layer: CALayer
  private(set) var needsLayout = false
  private(set) var needsDisplay = false

  class var layerClass: CALayer.Type { CALayer.self }
  init(frame: CGRect) {
    self.frame = frame
    layer = CALayer()
    super.init()
  }
  convenience override init() { self.init(frame: .zero) }
  required init?(coder: NSCoder) { fatalError("unavailable") }

  var window: UIWindow? {
    var v: UIView? = self
    while let c = v { if let w = c as? UIWindow { return w }; v = c.superview }
    return nil
  }
  func addSubview(_ v: UIView) {
    v.removeFromSuperview()
    subviews.append(v)
    v.superview = self
  }
  func removeFromSuperview() {
    superview?.subviews.removeAll { $0 === self }
    superview = nil
  }
  func bringSubviewToFront(_ v: UIView) {
    guard subviews.contains(where: { $0 === v }) else { return }
    subviews.removeAll { $0 === v }
    subviews.append(v)
  }

  func setNeedsLayout() { needsLayout = true }
  func layoutIfNeeded() {
    if needsLayout { needsLayout = false; layoutSubviews() }
    for s in subviews { s.layoutIfNeeded() }
  }
  func layoutSubviews() {}
  func setNeedsDisplay() { needsDisplay = true }
  /// The display pass: draw() for every view that asked for one.
  func displayIfNeeded() {
    if needsDisplay { needsDisplay = false; draw(bounds) }
    for s in subviews { s.displayIfNeeded() }
  }
  func draw(_ rect: CGRect) {}

  // Coordinates: no transforms anywhere in the keyboard, so a view's position
  // in the window is the sum of its ancestors' frame origins.
  var originInWindow: CGPoint {
    var p = frame.origin
    var v = superview
    while let s = v { p.x += s.frame.origin.x; p.y += s.frame.origin.y; v = s.superview }
    return p
  }
  func convert(_ r: CGRect, from v: UIView?) -> CGRect {
    let a = v?.originInWindow ?? .zero, b = originInWindow
    return r.offsetBy(dx: a.x - b.x, dy: a.y - b.y)
  }
  func convert(_ p: CGPoint, from v: UIView?) -> CGPoint {
    let a = v?.originInWindow ?? .zero, b = originInWindow
    return CGPoint(x: p.x + a.x - b.x, y: p.y + a.y - b.y)
  }
  func convert(_ p: CGPoint, to v: UIView?) -> CGPoint {
    let a = originInWindow, b = v?.originInWindow ?? .zero
    return CGPoint(x: p.x + a.x - b.x, y: p.y + a.y - b.y)
  }

  func point(inside point: CGPoint, with event: UIEvent?) -> Bool { bounds.contains(point) }
  /// UIKit's rule: a hidden, transparent or non-interactive view — and every
  /// view inside it — is invisible to touch; a subview is only asked when the
  /// point is inside its parent; the frontmost subview answers first.
  func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard isUserInteractionEnabled, !isHidden, alpha > 0.01,
          self.point(inside: point, with: event) else { return nil }
    for s in subviews.reversed() {
      if let h = s.hitTest(convert(point, to: s), with: event) { return h }
    }
    return self
  }

  func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {}
  func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {}
  func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {}
  func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {}
}

final class UIWindow: UIView {}

class UIStackView: UIView {
  enum Axis { case horizontal, vertical }
  var axis: Axis = .horizontal
  var spacing: CGFloat = 0
  private(set) var arrangedSubviews: [UIView] = []
  func addArrangedSubview(_ v: UIView) { arrangedSubviews.append(v); addSubview(v) }
}

final class UITouch: NSObject {
  var windowPoint: CGPoint
  let began: Double
  init(at p: CGPoint) { windowPoint = p; began = Clock.now }
  func location(in view: UIView?) -> CGPoint { view?.convert(windowPoint, from: nil) ?? windowPoint }
}

final class UIEvent: NSObject {
  var byView: [ObjectIdentifier: Set<UITouch>] = [:]
  func touches(for view: UIView) -> Set<UITouch>? { byView[ObjectIdentifier(view)] }
}

// MARK: - Controls

final class UIAction {
  let handler: (UIAction) -> Void
  init(handler: @escaping (UIAction) -> Void) { self.handler = handler }
}

class UIControl: UIView {
  struct Event: OptionSet, Hashable {
    let rawValue: Int
    static let touchDown = Event(rawValue: 1 << 0)
    static let touchDownRepeat = Event(rawValue: 1 << 1)
    static let touchDragInside = Event(rawValue: 1 << 2)
    static let touchDragOutside = Event(rawValue: 1 << 3)
    static let touchDragEnter = Event(rawValue: 1 << 4)
    static let touchDragExit = Event(rawValue: 1 << 5)
    static let touchUpInside = Event(rawValue: 1 << 6)
    static let touchUpOutside = Event(rawValue: 1 << 7)
    static let touchCancel = Event(rawValue: 1 << 8)
    static let allTouchEvents = Event(rawValue: 0x1FF)
  }
  var isEnabled = true
  private var handlers: [(Event, (UIControl, UIEvent?) -> Void)] = []
  /// Target/action, the closure form: the generator rewrites `#selector(f(_:))`
  /// into a closure over the same method, so the method bodies are verbatim.
  func addTarget(_ target: AnyObject?, action: @escaping (UIButton, UIEvent?) -> Void, for events: Event) {
    handlers.append((events, { c, e in action(c as! UIButton, e) }))
  }
  func addAction(_ a: UIAction, for events: Event) {
    handlers.append((events, { _, _ in a.handler(a) }))
  }
  /// Handlers run in the order they were added, as UIKit does in practice.
  func sendActions(for events: Event) { dispatch(events, nil) }
  func dispatch(_ ev: Event, _ event: UIEvent?) {
    for (mask, h) in handlers where !mask.intersection(ev).isEmpty { h(self, event) }
  }
}

class UIButton: UIControl {
  private var titles: [UInt: String] = [:]
  func setTitle(_ t: String?, for state: UInt) { titles[state] = t }
  func title(for state: UInt) -> String? { titles[state] }
}
extension UInt { static let normal: UInt = 0 }
