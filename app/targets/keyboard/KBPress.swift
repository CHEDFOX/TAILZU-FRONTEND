import UIKit

/// PRESS EFFECTS — `fade`, `pop`, `glow`.
///
/// Four rules, and they are the whole design:
///
///   1. **Visual only.** A press effect never changes what a key does, and
///      nothing here reads or touches text (App Review 4.4.1).
///   2. **After the commit.** `begin` is called from the renderer's
///      `keyTouchDown`, which is where the key's colour already swaps; the
///      letter is inserted by the key's own action on the same event, or by
///      the typing plane's `commitOnDown`. Everything here is two layer
///      properties and a CAAnimation — no layout, no decode, no allocation
///      per keystroke beyond the glow's one layer — so `insertText` is never
///      waiting on it.
///   3. **The next touch cancels it.** `begin` always resets first, so fast
///      rollover across six keys leaves nothing half-played behind.
///   4. **An unknown kind, or Reduce Motion, is `fade`** — today's effect,
///      which is the key's own colour swap and needs nothing from this file.
///
/// `pop` moves the key's CONTENTS, not the key: `layer.sublayerTransform`
/// scales and lifts the title, the print and the art about the cap's centre
/// while the cap's own frame stays exactly where it was. That matters more
/// than it looks — the multi-touch typing plane caches every key's rect and
/// re-reads it when the geometry moves (`convert(b.bounds, from: b)`), so a
/// transform on the button itself would make the plane rebuild its frame
/// cache under every keystroke, and would move the hit target under a finger
/// that is already down.
enum KBPress {

  struct Spec {
    let kind: String          // fade | pop | glow
    let seconds: Double
    let scale: CGFloat
    let dy: CGFloat
    let color: UIColor?
    let ease: String          // linear | ease | spring
  }

  // MARK: Reading one

  /// `style.press` on a key node. nil means today's behaviour.
  static func parse(_ style: [String: KBJSON]?) -> Spec? {
    guard let o = style?["press"]?.asObject else { return nil }
    var kind = (o["kind"]?.asString ?? "fade").lowercased()
    // An unknown kind falls back to fade, exactly as Reduce Motion does.
    if kind != "pop" && kind != "glow" { kind = "fade" }
    let ms = min(KBSkin.maxPressMs, max(0, o["ms"]?.asDouble ?? 140))
    return Spec(
      kind: kind,
      seconds: ms / 1000.0,
      // THE SAME CLAMPS AS THE ANDROID IME, so one `press` block looks the
      // same on both phones. On a 32 pt key with the usual 6 pt gap, 1.12
      // grows about 1.9 pt a side and stays inside its half of the gap; 6 pt
      // is about half the row gap; 0.9 allows a press-in sink. The server
      // refuses anything outside these and writes all three explicitly, so
      // no phone default decides how a skin looks — these are the backstop.
      scale: min(1.12, max(0.9, o["scale"]?.asCGFloat ?? 1.08)),
      dy: min(6, max(-6, o["dy"]?.asCGFloat ?? 0)),
      color: o["color"]?.asString.map { UIColor(tulmiHex: $0) },
      ease: (o["ease"]?.asString ?? "ease").lowercased())
  }

  // MARK: Attaching one to a key

  private static var specKey: UInt8 = 0
  private static var glowKey: UInt8 = 0

  /// Remember a key's press effect. Read again on every touch, so a remount
  /// mid-gesture cannot leave an effect pointing at a dead view.
  static func attach(_ spec: Spec?, to view: UIView) {
    objc_setAssociatedObject(view, &specKey, spec.map { Box($0) }, .OBJC_ASSOCIATION_RETAIN)
  }

  private final class Box {
    let spec: Spec
    init(_ s: Spec) { self.spec = s }
  }

  private static func spec(of view: UIView) -> Spec? {
    guard !KBSkin.plainMode else { return nil }
    return (objc_getAssociatedObject(view, &specKey) as? Box)?.spec
  }

  // MARK: Playing one

  /// The finger is down. Called from `keyTouchDown`, which both the plain
  /// button path and the typing plane route through.
  static func begin(on view: UIView) {
    guard let spec = spec(of: view) else { return }
    if UIAccessibility.isReduceMotionEnabled { return }   // fade: the colour swap alone
    switch spec.kind {
    case "pop":
      let t = CATransform3DConcat(
        CATransform3DMakeScale(spec.scale, spec.scale, 1),
        CATransform3DMakeTranslation(0, spec.dy, 0))
      animateSublayerTransform(view.layer, to: t, spec: spec)
    case "glow":
      let g = glowView(for: view, color: spec.color ?? UIColor(white: 1, alpha: 0.25))
      g.layer.removeAllAnimations()
      g.frame = view.bounds
      g.layer.cornerRadius = view.layer.cornerRadius
      g.alpha = 1
    default:
      break
    }
  }

  /// The finger left — lifted, rolled off, or cancelled. Everything goes back
  /// where it was, on the same clock.
  static func end(on view: UIView) {
    guard let spec = spec(of: view) else { return }
    switch spec.kind {
    case "pop":
      animateSublayerTransform(view.layer, to: CATransform3DIdentity, spec: spec)
    case "glow":
      guard let g = objc_getAssociatedObject(view, &glowKey) as? UIView else { return }
      UIView.animate(withDuration: spec.seconds,
                     delay: 0,
                     options: [.curveEaseOut, .allowUserInteraction, .beginFromCurrentState],
                     animations: { g.alpha = 0 },
                     completion: nil)
    default:
      break
    }
  }

  // A key that goes away mid-press needs no undoing: the tree is rebuilt
  // from scratch on every shift, layer switch and appearance change, so the
  // transform and the wash go with the view that held them.

  private static func animateSublayerTransform(_ layer: CALayer, to t: CATransform3D, spec: Spec) {
    // The next touch cancels the last: start from where the layer actually
    // is, never from where the finished animation said it would be.
    let from = layer.presentation()?.sublayerTransform ?? layer.sublayerTransform
    layer.removeAnimation(forKey: "press")
    layer.sublayerTransform = t
    let anim: CABasicAnimation
    if spec.ease == "spring" {
      let s = CASpringAnimation(keyPath: "sublayerTransform")
      s.damping = 18
      s.stiffness = 320
      s.mass = 0.5
      s.initialVelocity = 0
      anim = s
    } else {
      anim = CABasicAnimation(keyPath: "sublayerTransform")
      anim.timingFunction = CAMediaTimingFunction(name: spec.ease == "linear" ? .linear : .easeOut)
    }
    anim.fromValue = NSValue(caTransform3D: from)
    anim.toValue = NSValue(caTransform3D: t)
    // A spring settles on its own clock; everything else takes the server's,
    // already clamped to 400 ms.
    if !(anim is CASpringAnimation) { anim.duration = spec.seconds }
    layer.add(anim, forKey: "press")
  }

  /// The wash goes OVER the whole cap, legend included — that is what a glow
  /// is, and the server picks a colour with its own alpha (`#FFFFFF40`). A
  /// view, not a bare layer, so it sits above the theme's blur backdrop and
  /// the node's gradient, which are subviews inserted at the bottom of the
  /// key's own stack. Made on the first press and kept with the key; it takes
  /// no touches, so the key under it types exactly as before.
  private static func glowView(for view: UIView, color: UIColor) -> UIView {
    if let hit = objc_getAssociatedObject(view, &glowKey) as? UIView {
      hit.backgroundColor = color
      if hit.superview !== view { view.addSubview(hit) }
      view.bringSubviewToFront(hit)
      return hit
    }
    let g = UIView(frame: view.bounds)
    g.backgroundColor = color
    g.layer.cornerRadius = view.layer.cornerRadius
    g.isUserInteractionEnabled = false
    g.alpha = 0
    view.addSubview(g)
    objc_setAssociatedObject(view, &glowKey, g, .OBJC_ASSOCIATION_RETAIN)
    return g
  }
}
