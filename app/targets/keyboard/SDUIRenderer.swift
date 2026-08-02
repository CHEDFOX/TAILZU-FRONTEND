import UIKit
import AVFoundation

// =============================================================================
// KeyRowStackView — a horizontal key row that never wastes a touch.
//
// A UIStackView leaves a `spacing` gap between arranged keys; a finger landing
// in that gap hits the stack itself, not any key, so the tap is lost. During
// fast typing those near-misses feel like the keyboard "dropped" a key.
//
// This subclass divides the whole row among its keys: a touch that misses every
// key routes to the horizontally nearest key control (each inter-key gap split
// down the middle). Real hits on a key are untouched — only gap misses are
// re-routed — so long-press gestures, drag-off cancel, and the press animation
// all keep working exactly as before. Visuals are identical; only the invisible
// hit area changes.
// =============================================================================
final class KeyRowStackView: UIStackView {
  /// Backend kill-switch (kb.row.expandHitTargets). When false the row behaves
  /// like a plain UIStackView, so the gap routing can be turned off remotely
  /// without a rebuild if it ever misbehaves.
  var gapRoutingEnabled = true

  /// True when `view` is one of our arranged keys or a descendant of one — as
  /// opposed to a full-row backdrop (gradient / blur / solid) inserted at
  /// subview index 0, which also "contains" a gap point but must NOT count as
  /// a real key hit or it would swallow the touch and defeat gap routing.
  private func isArrangedKeyHit(_ view: UIView) -> Bool {
    var cur: UIView? = view
    while let c = cur, c !== self {
      if arrangedSubviews.contains(c) { return true }
      cur = c.superview
    }
    return false
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    guard gapRoutingEnabled else { return hit }
    // A real hit on a key (or one of its subviews) wins as-is. A hit on a
    // backdrop or on the stack itself falls through to nearest-key routing.
    if let hit, isArrangedKeyHit(hit) { return hit }
    // The touch missed every key. Only claim points inside the row band.
    guard isUserInteractionEnabled, !isHidden, alpha > 0.01, bounds.contains(point) else {
      return hit
    }
    // Find the enabled key control whose horizontal span is nearest the touch.
    // Distance is 0 when the touch x is within a key's x-range, so ties never
    // happen; each gap is claimed by whichever neighbor is closer (i.e. split
    // at the gap midpoint).
    var nearest: UIControl?
    var bestDX = CGFloat.greatestFiniteMagnitude
    for sub in arrangedSubviews {
      guard let key = sub as? UIControl,
            key.isEnabled, key.isUserInteractionEnabled, !key.isHidden, key.alpha > 0.01
      else { continue }
      let f = key.frame
      let dx: CGFloat = point.x < f.minX ? f.minX - point.x
                      : point.x > f.maxX ? point.x - f.maxX
                      : 0
      if dx < bestDX { bestDX = dx; nearest = key }
    }
    guard let key = nearest else { return hit }
    // Deliver to that key: clamp the point inside its bounds so the key's own
    // hitTest returns it and its targets / gestures fire normally.
    let lx = min(max(point.x - key.frame.minX, key.bounds.minX + 0.5), key.bounds.maxX - 0.5)
    return key.hitTest(CGPoint(x: lx, y: key.bounds.midY), with: event) ?? key
  }
}

// =============================================================================
// KeyHitButton — a key with an expanded touch target (hit slop).
//
// A plain UIButton commits on .touchUpInside, which re-checks the button's OWN
// bounds at LIFT time. So a tap that lands in the ~6pt gap between keys — or a
// finger that rolls a few points off the key before lifting (normal fast
// typing) — is outside the bounds, fires .touchUpOutside, and the character is
// silently dropped. That is the "shows feedback but only a firm, dead-center
// tap actually types" bug.
//
// Expanding point(inside:) fixes BOTH ends: the row's gap-router (above) finds
// this key on touch-DOWN, and the up-time bounds check now passes for near-key
// / drifted touches, so the tap commits. Slop is backend-tunable via
// kb.key.hitSlop.x / kb.key.hitSlop.y (0 = plain bounds). NOTE: must be created
// with init(frame:) — UIButton.init(type:) does NOT return a subclass instance.
// =============================================================================
final class KeyHitButton: UIButton {
  var hitSlop: UIEdgeInsets = .zero
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    bounds.inset(by: UIEdgeInsets(
      top: -hitSlop.top, left: -hitSlop.left, bottom: -hitSlop.bottom, right: -hitSlop.right
    )).contains(point)
  }
}

// =============================================================================
// KeyPlaneView — optional (kb.keyPlane.enabled) multi-touch layer over the
// character keys.
//
// UIButton + target-action tracks ONE touch per control and can't follow a
// finger ROLLING from one key to the next — the main fast-typing gap vs the
// system keyboard. This transparent view sits above the key grid and owns touch
// for the character keys ONLY (shift / delete / space / mic fall through and
// keep their own handling). It:
//   • tracks every simultaneous touch independently (two-thumb + rolling),
//   • highlights + haptics on touch-DOWN, follows the finger key-to-key on
//     touch-MOVE, and commits the char under the finger on touch-UP — so a
//     slide off the grid cancels (native slide-to-cancel),
//   • routes the gaps between keys to the nearest key.
//
// The character keys stay real UIButtons (userInteraction OFF) so every visual,
// title, fast-shift update and flash-on-refine keeps working untouched — this
// view centralizes *touch* only; it does not re-implement rendering.
//
// v1 scope: accent long-press trays are NOT handled while the plane is on; the
// flag is OFF by default and this is opt-in until v2 routes accents through the
// plane. Everything else (rolling, multi-touch, slide-cancel, press feedback)
// is here.
final class KeyPlaneView: UIView {
  struct Key { weak var button: UIButton?; let char: String }

  private let keys: [Key]
  private weak var renderer: SDUIRenderer?

  /// Per-active-touch state: the key currently under that finger.
  private final class Track {
    weak var button: UIButton?
    var char: String?
    init(_ b: UIButton?, _ c: String?) { button = b; char = c }
  }
  private var tracks: [ObjectIdentifier: Track] = [:]

  /// True while any finger is down on the plane. The renderer defers config
  /// remounts on this — swapping the tree mid-touch dropped the keystroke.
  var hasActiveTouches: Bool { !tracks.isEmpty }

  /// Key frames in this view's coordinate space, refreshed on layout.
  private var frames: [(button: UIButton, char: String, rect: CGRect)] = []

  init(keys: [Key], renderer: SDUIRenderer) {
    self.keys = keys
    self.renderer = renderer
    super.init(frame: .zero)
    isMultipleTouchEnabled = true
    isUserInteractionEnabled = true
    backgroundColor = .clear
    isOpaque = false
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

  override func layoutSubviews() {
    super.layoutSubviews()
    refreshFrames()
  }

  private func refreshFrames() {
    var out: [(UIButton, String, CGRect)] = []
    for k in keys {
      guard let b = k.button, b.window != nil else { continue }
      let r = convert(b.bounds, from: b)
      if r.width <= 0 || r.height <= 0 { continue }
      out.append((b, k.char, r))
    }
    frames = out
  }

  /// The character key nearest `point`, but only when `point` genuinely lands
  /// on the character grid (same row band + within a half-key horizontal
  /// reach). Returns nil for the special-key columns and other rows so those
  /// touches fall through to the controls beneath.
  private func keyAt(_ point: CGPoint) -> (button: UIButton, char: String)? {
    if frames.isEmpty { refreshFrames() }
    var best: (button: UIButton, char: String, dist: CGFloat)?
    for f in frames {
      // Vertically inside the key's row band (+small margin).
      if abs(point.y - f.rect.midY) > f.rect.height / 2 + 6 { continue }
      // Horizontal distance to the rect (0 when inside it).
      let dx: CGFloat
      if point.x < f.rect.minX { dx = f.rect.minX - point.x }
      else if point.x > f.rect.maxX { dx = point.x - f.rect.maxX }
      else { dx = 0 }
      // Only own the point within ~half a key of a real key; beyond that
      // (shift / delete columns) let it fall through.
      if dx > f.rect.width / 2 + 6 { continue }
      if best == nil || dx < best!.dist { best = (f.button, f.char, dx) }
    }
    guard let b = best else { return nil }
    return (b.button, b.char)
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    // Own the touch only over the character grid; else nil so shift / delete /
    // space / mic below receive it normally.
    keyAt(point) != nil ? self : nil
  }

  // MARK: - Multi-touch

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    // Re-derive key rects at the START of every touch sequence. layoutSubviews
    // caches them too, but if the grid's layout settled AFTER that cache (or the
    // cache was taken mid-animation), keyAt would match every finger against
    // stale positions — mis-detecting keys and dropping all but dead-center taps.
    // This is the fix for "the keyboard only responds to a hard touch on the key"
    // AND poor fast-typing: detection is now always against live geometry.
    // Cheap — a couple dozen convert() calls, once per finger-down.
    refreshFrames()
    for t in touches {
      let hit = keyAt(t.location(in: self))
      tracks[ObjectIdentifier(t)] = Track(hit?.button, hit?.char)
      if let b = hit?.button { renderer?.planeDown(b) }
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches {
      guard let track = tracks[ObjectIdentifier(t)] else { continue }
      let hit = keyAt(t.location(in: self))
      if track.button !== hit?.button {
        if let old = track.button { renderer?.planeUp(old) }   // rolled off old
        if let nw = hit?.button { renderer?.planeDown(nw) }    // onto the next
        track.button = hit?.button
        track.char = hit?.char
      }
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches {
      guard let track = tracks.removeValue(forKey: ObjectIdentifier(t)) else { continue }
      if let b = track.button { renderer?.planeUp(b) }
      // Commit the char under the finger at release. If it slid off the grid
      // (button == nil) nothing commits — native slide-to-cancel.
      if let char = track.char { renderer?.planeCommit(char: char) }
    }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches {
      guard let track = tracks.removeValue(forKey: ObjectIdentifier(t)) else { continue }
      if let b = track.button { renderer?.planeUp(b) }
    }
  }
}

// =============================================================================
// KeyCalloutView — the native "key pop" balloon shown above a pressed letter.
//
// The single biggest tell of a non-native keyboard is the absence of the
// magnified character bubble that iOS floats over the key you're pressing. This
// draws that exact shape: a rounded-rect head, wider than the key, joined to the
// key's top edge by a tapering neck — one filled bezier with a soft shadow, and
// the character drawn large in the head. It's a passive overlay (userInteraction
// off); the renderer positions it on touch-down and hides it on release, so it
// follows the finger during a rolling multi-touch slide for free.
final class KeyCalloutView: UIView {
  private let shape = CAShapeLayer()
  private let label = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    shape.shadowColor = UIColor.black.cgColor
    shape.shadowOpacity = 0.18
    shape.shadowRadius = 5
    shape.shadowOffset = CGSize(width: 0, height: 2)
    layer.addSublayer(shape)
    label.textAlignment = .center
    addSubview(label)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

  /// Position + draw the balloon for `keyRect` (in `parent`'s coords), showing
  /// `char`. `bg`/`text` are the balloon fill + glyph colors.
  func present(keyRect: CGRect, char: String, in parent: UIView,
               bg: UIColor, text: UIColor, glyphSize: CGFloat) {
    let headW = max(keyRect.width + 28, 44)
    let headH = keyRect.height + 8
    let neckH: CGFloat = 10
    let r: CGFloat = 7
    // Center the head over the key, clamped inside the parent.
    var headX = keyRect.midX - headW / 2
    headX = max(3, min(headX, parent.bounds.width - headW - 3))
    let topY = keyRect.minY - neckH - headH
    frame = CGRect(x: headX, y: topY, width: headW, height: headH + neckH + 1)

    // Neck attach points, in local coords, clamped so the shoulders never cross.
    let keyMinX = keyRect.minX - headX
    let keyMaxX = keyRect.maxX - headX
    let hw = headW, hh = headH
    let rightShoulder = min(keyMaxX + 4, hw - r)
    let leftShoulder = max(keyMinX - 4, r)

    let p = UIBezierPath()
    p.move(to: CGPoint(x: 0, y: r))
    p.addQuadCurve(to: CGPoint(x: r, y: 0), controlPoint: CGPoint(x: 0, y: 0))            // head TL
    p.addLine(to: CGPoint(x: hw - r, y: 0))
    p.addQuadCurve(to: CGPoint(x: hw, y: r), controlPoint: CGPoint(x: hw, y: 0))          // head TR
    p.addLine(to: CGPoint(x: hw, y: hh - r))
    p.addQuadCurve(to: CGPoint(x: hw - r, y: hh), controlPoint: CGPoint(x: hw, y: hh))    // head BR
    p.addLine(to: CGPoint(x: rightShoulder, y: hh))                                        // right shoulder
    p.addQuadCurve(to: CGPoint(x: keyMaxX, y: hh + neckH),
                   controlPoint: CGPoint(x: keyMaxX + 2, y: hh + neckH * 0.5))             // neck → key R
    p.addLine(to: CGPoint(x: keyMinX, y: hh + neckH))                                      // key top edge
    p.addQuadCurve(to: CGPoint(x: leftShoulder, y: hh),
                   controlPoint: CGPoint(x: keyMinX - 2, y: hh + neckH * 0.5))             // neck → head L
    p.addLine(to: CGPoint(x: r, y: hh))                                                    // left shoulder
    p.addQuadCurve(to: CGPoint(x: 0, y: hh - r), controlPoint: CGPoint(x: 0, y: hh))       // head BL
    p.close()

    shape.path = p.cgPath
    shape.fillColor = bg.cgColor
    shape.shadowPath = p.cgPath
    label.text = char
    label.textColor = text
    label.font = .systemFont(ofSize: glyphSize, weight: .regular)
    label.frame = CGRect(x: 0, y: 0, width: hw, height: hh)

    if superview !== parent { removeFromSuperview(); parent.addSubview(self) }
    parent.bringSubviewToFront(self)
    isHidden = false
  }
}

// =============================================================================
// MicParticleView — the recording-state mic visual.
//
// Idle, the mic button shows the Tailzu brand mark ("the structure"). When
// recording starts, the structure gives way to a few very tiny dots that wander
// inside the round button, bouncing off the circular wall and off each other —
// a fully physics-based little sim. Deliberately lightweight (a handful of dots,
// one CADisplayLink, plain Core Graphics fills) so it's safe inside the keyboard
// extension's tight memory/CPU budget.
//
// It self-manages its display link off window attachment, so the renderer just
// adds/removes it with the rest of the tree — no manual start/stop, no leaked
// CADisplayLink (which would otherwise retain the view and keep ticking).
// =============================================================================
final class MicParticleView: UIView {
  private struct Dot { var p: CGPoint; var v: CGVector }
  private var dots: [Dot] = []
  private var link: CADisplayLink?
  private var seeded = false

  // Two physics modes drive the whole idle⇄recording round trip:
  //   • .disperse   — recording: the mark bursts apart and the dots wander,
  //                   bouncing off the wall and each other (perpetual).
  //   • .reassemble — stopping: each dot springs back to its home point on the
  //                   mark, settles, and hands off to the crisp static mark.
  // The SAME instance carries its dots across the stop remount (the renderer
  // holds a strong ref), so wander → converge is one unbroken motion.
  private enum Mode { case disperse, reassemble }
  private var mode: Mode = .disperse
  private var targets: [CGPoint] = []          // home points during .reassemble
  private var reassembleElapsed: CGFloat = 0
  private var reassembleFinished = false
  private var onReassembleDone: (() -> Void)?

  private let count: Int
  private let dotRadius: CGFloat
  private let color: UIColor
  private let sourceImage: UIImage?   // the brand mark the dots disperse FROM

  init(count: Int, dotRadius: CGFloat, color: UIColor, sourceImage: UIImage?) {
    self.count = max(2, count)
    self.dotRadius = max(0.5, dotRadius)
    self.color = color
    self.sourceImage = sourceImage
    super.init(frame: .zero)
    backgroundColor = .clear
    isOpaque = false
    isUserInteractionEnabled = false
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { stop() } else { start() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if !seeded && bounds.width > 4 { seed() }
  }

  private var radius: CGFloat { min(bounds.width, bounds.height) / 2 }
  private var mid: CGPoint { CGPoint(x: bounds.midX, y: bounds.midY) }

  private func start() {
    guard link == nil else { return }
    if !seeded && bounds.width > 4 { seed() }
    let l = CADisplayLink(target: self, selector: #selector(step(_:)))
    l.add(to: .main, forMode: .common)
    link = l
  }

  private func stop() {
    link?.invalidate()
    link = nil
  }

  // Seed the dots AS THE STRUCTURE: sample the brand mark's shape for their
  // starting positions (so frame 0 still reads as the mark), then give each an
  // outward burst so the structure visibly bursts apart into particles. Falls
  // back to a random spread if the mark can't be sampled.
  private func seed() {
    seeded = true
    dots.removeAll()
    let starts = sourceImage.map { markPoints($0, want: count) } ?? []
    let c = mid
    let r = max(1, radius - dotRadius)
    for i in 0..<count {
      let p: CGPoint
      if i < starts.count {
        p = starts[i]
      } else {
        let ang = CGFloat.random(in: 0 ..< (2 * .pi))
        let rad = r * sqrt(CGFloat.random(in: 0...1))        // uniform in the disc
        p = CGPoint(x: c.x + cos(ang) * rad, y: c.y + sin(ang) * rad)
      }
      dots.append(Dot(p: p, v: burstVelocity(from: p)))
    }
  }

  /// An outward kick from the centre through `p` (so the mark bursts apart),
  /// with a small angular jitter so dots at the same radius don't move in
  /// lockstep. Reused by `seed()` and by a re-burst on record-restart.
  private func burstVelocity(from p: CGPoint) -> CGVector {
    let c = mid
    var dx = p.x - c.x, dy = p.y - c.y
    let len = (dx * dx + dy * dy).squareRoot()
    if len > 0.5 { dx /= len; dy /= len }
    else { let a = CGFloat.random(in: 0 ..< (2 * .pi)); dx = cos(a); dy = sin(a) }
    let j = CGFloat.random(in: -0.5...0.5)
    let rx = dx * cos(j) - dy * sin(j), ry = dx * sin(j) + dy * cos(j)
    let burst = CGFloat.random(in: 55...110)                 // points / second
    return CGVector(dx: rx * burst, dy: ry * burst)
  }

  // MARK: Mode transitions (driven by the renderer's reflectDictating)

  /// Enter / re-enter the recording wander. If the dots are mid-reassembly
  /// (user tapped record again before the structure fully re-formed), give them
  /// a fresh outward burst so they scatter instead of finishing their homing.
  func beginRecording() {
    let wasReassembling = mode == .reassemble
    mode = .disperse
    targets = []
    reassembleElapsed = 0
    reassembleFinished = false
    onReassembleDone = nil
    if wasReassembling {
      for i in dots.indices { dots[i].v = burstVelocity(from: dots[i].p) }
    }
    start()
  }

  /// Reverse of the burst: each dot springs back to its home point on the mark,
  /// settles, then `onComplete` fires so the renderer can swap in the crisp
  /// static mark. If we never seeded (no bounds/image yet) there's nothing to
  /// converge — complete immediately so the caller isn't left hanging.
  func reassemble(onComplete: @escaping () -> Void) {
    guard seeded, !dots.isEmpty else { onComplete(); return }
    mode = .reassemble
    reassembleElapsed = 0
    reassembleFinished = false
    onReassembleDone = onComplete
    targets = homeTargets()
    start()
  }

  /// Home points for the dots to converge onto — the mark's shape again. When
  /// there are more dots than sampled points we cycle the points; with no image
  /// the dots gather at the centre.
  private func homeTargets() -> [CGPoint] {
    let pts = sourceImage.map { markPoints($0, want: dots.count) } ?? []
    guard !pts.isEmpty else { return [] }
    return dots.indices.map { pts[$0 % pts.count] }
  }

  @objc private func step(_ link: CADisplayLink) {
    guard !dots.isEmpty else { return }
    let dt = CGFloat(min(link.duration, 1.0 / 30.0))         // clamp long frames
    if mode == .reassemble { stepReassemble(dt); return }
    stepDisperse(dt)
  }

  /// Recording: burst → wall-bounce → collide → wander (perpetual).
  private func stepDisperse(_ dt: CGFloat) {
    let c = mid
    let wall = max(0, radius - dotRadius)

    // Integrate + bounce off the circular wall (reflect about the radial normal).
    for i in dots.indices {
      dots[i].p.x += dots[i].v.dx * dt
      dots[i].p.y += dots[i].v.dy * dt
      let dx = dots[i].p.x - c.x, dy = dots[i].p.y - c.y
      let d = (dx * dx + dy * dy).squareRoot()
      if d > wall && d > 0 {
        let nx = dx / d, ny = dy / d
        dots[i].p.x = c.x + nx * wall
        dots[i].p.y = c.y + ny * wall
        let vn = dots[i].v.dx * nx + dots[i].v.dy * ny
        dots[i].v.dx -= 2 * vn * nx
        dots[i].v.dy -= 2 * vn * ny
      }
    }

    // Pairwise elastic collisions (equal mass; a handful of dots → O(n²) is nothing).
    let minD = dotRadius * 2
    for a in 0 ..< dots.count {
      for b in (a + 1) ..< dots.count {
        let dx = dots[b].p.x - dots[a].p.x
        let dy = dots[b].p.y - dots[a].p.y
        let d = (dx * dx + dy * dy).squareRoot()
        guard d < minD, d > 0.0001 else { continue }
        let nx = dx / d, ny = dy / d
        let overlap = (minD - d) / 2
        dots[a].p.x -= nx * overlap; dots[a].p.y -= ny * overlap
        dots[b].p.x += nx * overlap; dots[b].p.y += ny * overlap
        let rvn = (dots[b].v.dx - dots[a].v.dx) * nx + (dots[b].v.dy - dots[a].v.dy) * ny
        if rvn < 0 {                                         // only if approaching
          dots[a].v.dx += rvn * nx; dots[a].v.dy += rvn * ny
          dots[b].v.dx -= rvn * nx; dots[b].v.dy -= rvn * ny
        }
      }
    }

    // Bleed the initial burst off (drag) but floor the speed HIGH, so the swarm
    // never settles — it keeps zipping and colliding off the wall and each other
    // for the whole recording instead of drifting to a near-stop.
    let drag: CGFloat = 0.99
    let minSpeed: CGFloat = 24
    for i in dots.indices {
      dots[i].v.dx *= drag; dots[i].v.dy *= drag
      let s = (dots[i].v.dx * dots[i].v.dx + dots[i].v.dy * dots[i].v.dy).squareRoot()
      if s > 0.001 && s < minSpeed {
        let k = minSpeed / s
        dots[i].v.dx *= k; dots[i].v.dy *= k
      }
    }
    setNeedsDisplay()
  }

  /// Stopping: each dot springs to its home point on the mark (damped so it
  /// settles instead of oscillating). When the cloud has landed — or a short
  /// backstop elapses — snap onto the targets for a crisp final frame and hand
  /// off to `onReassembleDone` so the renderer can show the static mark.
  private func stepReassemble(_ dt: CGFloat) {
    reassembleElapsed += dt
    let stiffness: CGFloat = 26                               // spring pull toward home
    let damping: CGFloat = 0.80                               // kills the bounce
    var maxDist: CGFloat = 0
    for i in dots.indices {
      let t = targets.isEmpty ? mid : targets[i % targets.count]
      let toX = t.x - dots[i].p.x, toY = t.y - dots[i].p.y
      dots[i].v.dx = (dots[i].v.dx + toX * stiffness * dt) * damping
      dots[i].v.dy = (dots[i].v.dy + toY * stiffness * dt) * damping
      dots[i].p.x += dots[i].v.dx * dt
      dots[i].p.y += dots[i].v.dy * dt
      let d = (toX * toX + toY * toY).squareRoot()
      if d > maxDist { maxDist = d }
    }
    setNeedsDisplay()

    if !reassembleFinished, maxDist < 0.8 || reassembleElapsed > 0.6 {
      // Snap home so the last frame is exactly the mark, then hand off.
      for i in dots.indices { dots[i].p = targets.isEmpty ? mid : targets[i % targets.count] }
      setNeedsDisplay()
      reassembleFinished = true
      let done = onReassembleDone
      onReassembleDone = nil
      stop()
      done?()
    }
  }

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    ctx.setFillColor(color.cgColor)
    for dot in dots {
      ctx.fillEllipse(in: CGRect(x: dot.p.x - dotRadius, y: dot.p.y - dotRadius,
                                 width: dotRadius * 2, height: dotRadius * 2))
    }
  }

  /// Sample up to `want` points from the brand mark's opaque area, mapped into
  /// this view's bounds — the dots start here so the mark is recognizable for a
  /// frame before it bursts. Returns [] (→ random spread) if it can't sample.
  private func markPoints(_ image: UIImage, want: Int) -> [CGPoint] {
    guard want > 0, bounds.width > 4, let cg = image.cgImage else { return [] }
    let w = 44, h = 44
    var data = [UInt8](repeating: 0, count: w * h * 4)
    guard let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return [] }
    // Aspect-fit the mark into the sampling square with a small inset.
    let inset: CGFloat = 6
    let box = CGFloat(min(w, h)) - inset * 2
    let scale = min(box / CGFloat(cg.width), box / CGFloat(cg.height))
    let dw = CGFloat(cg.width) * scale, dh = CGFloat(cg.height) * scale
    ctx.draw(cg, in: CGRect(x: (CGFloat(w) - dw) / 2, y: (CGFloat(h) - dh) / 2, width: dw, height: dh))

    var pts: [CGPoint] = []
    for y in 0..<h {
      for x in 0..<w where data[(y * w + x) * 4 + 3] > 90 {   // opaque → part of the mark
        // Bitmap origin is bottom-left; flip y into UIKit's top-left space.
        let px = (CGFloat(x) + 0.5) / CGFloat(w) * bounds.width
        let py = (CGFloat(h - 1 - y) + 0.5) / CGFloat(h) * bounds.height
        pts.append(CGPoint(x: px, y: py))
      }
    }
    guard pts.count > want else { return pts }
    // Even stride so the sample still traces the whole shape.
    var out: [CGPoint] = []
    let stride = CGFloat(pts.count) / CGFloat(want)
    var idx: CGFloat = 0
    while Int(idx) < pts.count && out.count < want { out.append(pts[Int(idx)]); idx += stride }
    return out
  }
}

// =============================================================================
// SDUIRenderer — server-driven UI renderer for Tulmi's iOS keyboard extension.
//
// When the backend config sets `features.sdui = true` and provides a `root`
// KeyboardNode tree, KeyboardViewController hands off UI construction to this
// renderer instead of hand-building UIButtons. Every node in the tree maps to
// a small UIView-building method here (LetterKey → UIButton, Row → horizontal
// UIStackView, BlurBackdrop → UIVisualEffectView, etc). Actions are decoded
// as a tagged union and dispatched through the host controller so dictation /
// refine / textDocumentProxy stay in the existing code path.
//
// The renderer is intentionally undiffed — the RN counterpart also rebuilds on
// state change, so we do too: `stateChanged()` tears the mounted subview down
// and re-runs `render()`. Cheap enough for keyboard-sized trees.
// =============================================================================

// MARK: - Host protocol

/// Back-reference the renderer holds weakly so it can call the existing
/// dictation / refine / text-proxy code paths that live on
/// KeyboardViewController without depending on its concrete type.
protocol KBHostControllerProtocol: AnyObject {
  var hostTextDocumentProxy: UITextDocumentProxy { get }
  var hostHasFullAccess: Bool { get }
  var hostExtensionContext: NSExtensionContext? { get }
  func hostLabel(_ key: String, _ fallback: String) -> String
  func hostStartDictation()
  func hostStopDictation()
  func hostRunRefine()
  func hostAdvanceInputMode()
  func hostPresent(_ vc: UIViewController)
  /// The current field's autocap trait. Used by the renderer to decide when to
  /// arm state.shift after inserts. Default `.sentences` matches iOS default.
  func hostAutocapitalizationType() -> UITextAutocapitalizationType
  /// The current field's returnKeyType, so the Return key can render its
  /// context-appropriate label (Go / Search / Send / Done…) + accent color.
  func hostReturnKeyType() -> UIReturnKeyType
  /// True when the user has multiple keyboards enabled (Apple exposes this as
  /// UIInputViewController.needsInputModeSwitchKey). When true, the space bar
  /// shows the current language code (e.g. "EN") like native iOS; when false
  /// it just shows "space".
  func hostNeedsInputModeSwitchKey() -> Bool
  /// Two-letter code of the currently active primary language (e.g. "EN",
  /// "FR"), used as the space bar label when multiple keyboards are enabled.
  /// Falls back to a locale-derived code if the primary language isn't set.
  func hostPrimaryLanguageCode() -> String
}

// MARK: - Polymorphic JSON value (for props / style bags)

/// Small Codable helper matching the `Record<string, any>` shape of props/style
/// bags in the SDUI schema. Kept intentionally lax — reads that don't match a
/// shape just return nil and the renderer falls back to defaults.
enum KBJSON: Decodable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([KBJSON])
  case object([String: KBJSON])

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null; return }
    if let b = try? c.decode(Bool.self) { self = .bool(b); return }
    if let d = try? c.decode(Double.self) { self = .number(d); return }
    if let s = try? c.decode(String.self) { self = .string(s); return }
    if let a = try? c.decode([KBJSON].self) { self = .array(a); return }
    if let o = try? c.decode([String: KBJSON].self) { self = .object(o); return }
    self = .null
  }

  var asString: String? {
    if case .string(let s) = self { return s }
    if case .number(let n) = self { return String(n) }
    if case .bool(let b) = self { return b ? "true" : "false" }
    return nil
  }
  var asDouble: Double? {
    if case .number(let n) = self { return n }
    if case .string(let s) = self, let n = Double(s) { return n }
    return nil
  }
  var asCGFloat: CGFloat? { asDouble.map { CGFloat($0) } }
  var asBool: Bool? {
    if case .bool(let b) = self { return b }
    if case .number(let n) = self { return n != 0 }
    if case .string(let s) = self { return ["true", "1", "yes"].contains(s.lowercased()) }
    return nil
  }
  var asObject: [String: KBJSON]? { if case .object(let o) = self { return o }; return nil }
  var asArray: [KBJSON]? { if case .array(let a) = self { return a }; return nil }
}

// MARK: - Codable schema

/// Top-level config sent by GET /v1/keyboard/config (schema-mirrors the TS
/// KeyboardConfigResponse in TAILZU-BACKEND/shared/types/sdui.ts).
struct KBConfig: Decodable {
  let schemaVersion: Int?
  let theme: KBTheme?
  // v3 dark/light adaptive palettes. When present, the renderer picks between
  // themeDark and themeLight based on the extension's current userInterface-
  // Style and re-renders on traitCollectionDidChange. When absent, `theme` is
  // the sole palette used (backward-compatible).
  let themeDark: KBTheme?
  let themeLight: KBTheme?
  let layouts: [KBLayout]?
  let features: KBFeatures?
  let labels: [String: String]?
  let root: KBNode?
  let actions: [String: KBActionSpec]?
  let cacheTtlSeconds: Int?
  let cacheVersion: String?
  let flags: [String: KBJSON]?
}

struct KBFeatures: Decodable {
  let voice: Bool?
  let refine: Bool?
  let streaming: Bool?
  let sdui: Bool?
}

struct KBTheme: Decodable {
  let background: String?
  let key: String?
  let keyText: String?
  let accent: String?
  let keyPressed: String?
  let backgroundEffect: KBEffect?
  let keyEffect: KBEffect?
  let keyRadius: Double?
  let keyShadow: Bool?
}

struct KBLayout: Decodable {
  let language: String
  let displayName: String?
  let rows: [[String]]
}

/// KeyboardEffect union — `{kind: "solid", color}` / `{kind: "blur", style}` /
/// `{kind: "gradient", colors[], direction?}`.
enum KBEffect: Decodable {
  case solid(color: String)
  case blur(style: String)
  case gradient(colors: [String], direction: String?)

  private enum Keys: String, CodingKey { case kind, color, style, colors, direction }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    let kind = try c.decode(String.self, forKey: .kind)
    switch kind {
    case "solid":
      self = .solid(color: (try? c.decode(String.self, forKey: .color)) ?? "#00000000")
    case "blur":
      self = .blur(style: (try? c.decode(String.self, forKey: .style)) ?? "regular")
    case "gradient":
      let colors = (try? c.decode([String].self, forKey: .colors)) ?? []
      let dir = try? c.decode(String.self, forKey: .direction)
      self = .gradient(colors: colors, direction: dir)
    default:
      // Unknown effect kind → transparent no-op backdrop, NOT a throw. Throwing
      // here failed the entire KBConfig decode, which silently discarded the
      // whole SDUI tree and fell back to the hand-built keyboard — so the
      // backend could never introduce a new effect kind without nuking SDUI on
      // older clients. Degrade gracefully instead (matches the unknown-node and
      // unknown-action philosophy elsewhere).
      self = .solid(color: "#00000000")
    }
  }
}

/// A single node in the SDUI keyboard tree. `on`/`bind` are kept lax; the
/// renderer reads them by convention.
struct KBNode: Decodable {
  let type: String
  let id: String?
  let props: [String: KBJSON]?
  let style: [String: KBJSON]?
  let children: [KBNode]?
  let bind: [String: String]?
  let on: [String: KBActionRef]?
  let effect: KBEffect?
  let visibleIf: KBCondition?
}

/// ActionRef = a string alias (looked up in config.actions) OR an inline
/// ActionSpec. Modeled as an enum so both forms decode transparently.
/// `indirect` is required because KBActionSpec.condition references KBActionRef,
/// creating a cycle Swift needs a heap indirection to size.
indirect enum KBActionRef: Decodable {
  case named(String)
  case inline(KBActionSpec)

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let s = try? c.decode(String.self) { self = .named(s); return }
    let spec = try KBActionSpec(from: decoder)
    self = .inline(spec)
  }
}

/// Tagged union of keyboard actions. Custom-decoded because Swift Codable
/// doesn't handle string-discriminated JSON unions natively. `indirect`
/// because `.condition` holds KBActionRef which wraps KBActionSpec.
indirect enum KBActionSpec: Decodable {
  // ----- text + editing -----
  case insertText(text: String)
  case insertKey(char: String)
  case deleteBackward
  case deleteWord
  case shift
  case capsLock
  case returnKey

  // ----- layouts + dictation + refine -----
  case switchLayout(language: String?)
  case showLanguageMenu
  case startDictation
  case stopDictation
  case runRefine
  case cycleTone

  // ----- app / system -----
  case openApp(screenId: String?)
  case openSettings
  case openUrl(url: String, external: Bool)

  // ----- feedback -----
  case haptic(style: String)
  case toast(message: String, tone: String)
  case confetti
  case speak(text: String, voice: String?)
  case playMedia(url: String)
  case stopMedia

  // ----- clipboard + share -----
  case copyToClipboard(text: String, toastMessage: String?)
  case readClipboard(assignTo: String)
  case share(text: String?, url: String?, title: String?)

  // ----- state store (backend can mutate state.user.* paths for setState) -----
  case setState(path: String, value: KBJSON)
  case toggleState(path: String)
  case incrementState(path: String, by: Double)
  case clearState(path: String)

  // ----- network + analytics + logging -----
  case callEndpoint(method: String, path: String, body: KBJSON?, assignTo: String?, onSuccess: KBActionRef?, onError: KBActionRef?)
  case analyticsTrack(event: String, props: KBJSON?)
  case log(message: String, level: String)

  // ----- cache + reload -----
  case clearCache
  case reloadApp

  // ----- flow control -----
  case sequence(actions: [KBActionRef])
  case parallel(actions: [KBActionRef])
  case condition(ifCond: KBCondition, then: KBActionRef, elseRef: KBActionRef?)
  case delay(ms: Double)

  // ----- extensibility slot: backend can invoke a named native handler
  // registered via SDUIRenderer.registerExtension(name:handler:). Unknown
  // names are silently ignored so backend can push forward-looking actions
  // that a given client build hasn't wired up yet — no crash, just a no-op.
  case extensionAction(name: String, params: KBJSON?)

  case unknown(kind: String)

  private enum Keys: String, CodingKey {
    case kind, text, char, language, screenId, style, actions, message, tone
    case url, external, voice
    case toastMessage, assignTo, title
    case path, value, by
    case method, body, onSuccess, onError
    case event, props, level, ms
    case name, params
    case ifCond = "if", then, elseRef = "else"
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    // A missing / undecodable kind defaults to a no-op .unknown rather than
    // throwing — one malformed action must not blow up decode and drop the
    // ENTIRE SDUI tree back to the hand-built keyboard (mirrors the graceful
    // per-field try? below, and the KBEffect unknown-kind philosophy).
    guard let kind = try? c.decode(String.self, forKey: .kind) else {
      self = .unknown(kind: ""); return
    }
    switch kind {
    case "insertText":
      self = .insertText(text: (try? c.decode(String.self, forKey: .text)) ?? "")
    case "insertKey":
      self = .insertKey(char: (try? c.decode(String.self, forKey: .char)) ?? "")
    case "deleteBackward": self = .deleteBackward
    case "deleteWord":     self = .deleteWord
    case "shift":          self = .shift
    case "capsLock":       self = .capsLock
    case "return":         self = .returnKey
    case "switchLayout":
      self = .switchLayout(language: try? c.decode(String.self, forKey: .language))
    case "showLanguageMenu": self = .showLanguageMenu
    case "startDictation":   self = .startDictation
    case "stopDictation":    self = .stopDictation
    case "runRefine":        self = .runRefine
    case "cycleTone":        self = .cycleTone
    case "openApp":
      self = .openApp(screenId: try? c.decode(String.self, forKey: .screenId))
    case "openSettings":     self = .openSettings
    case "openUrl":
      self = .openUrl(
        url: (try? c.decode(String.self, forKey: .url)) ?? "",
        external: (try? c.decode(Bool.self, forKey: .external)) ?? false
      )
    case "haptic":
      self = .haptic(style: (try? c.decode(String.self, forKey: .style)) ?? "light")
    case "toast":
      self = .toast(
        message: (try? c.decode(String.self, forKey: .message)) ?? "",
        tone: (try? c.decode(String.self, forKey: .tone)) ?? "info"
      )
    case "confetti":
      self = .confetti
    case "speak":
      self = .speak(
        text: (try? c.decode(String.self, forKey: .text)) ?? "",
        voice: try? c.decode(String.self, forKey: .voice)
      )
    case "playMedia":
      self = .playMedia(url: (try? c.decode(String.self, forKey: .url)) ?? "")
    case "stopMedia":
      self = .stopMedia
    case "copyToClipboard":
      self = .copyToClipboard(
        text: (try? c.decode(String.self, forKey: .text)) ?? "",
        toastMessage: try? c.decode(String.self, forKey: .toastMessage)
      )
    case "readClipboard":
      self = .readClipboard(assignTo: (try? c.decode(String.self, forKey: .assignTo)) ?? "")
    case "share":
      self = .share(
        text: try? c.decode(String.self, forKey: .text),
        url: try? c.decode(String.self, forKey: .url),
        title: try? c.decode(String.self, forKey: .title)
      )
    case "setState":
      self = .setState(
        path: (try? c.decode(String.self, forKey: .path)) ?? "",
        value: (try? c.decode(KBJSON.self, forKey: .value)) ?? .null
      )
    case "toggleState":
      self = .toggleState(path: (try? c.decode(String.self, forKey: .path)) ?? "")
    case "incrementState":
      self = .incrementState(
        path: (try? c.decode(String.self, forKey: .path)) ?? "",
        by: (try? c.decode(Double.self, forKey: .by)) ?? 1
      )
    case "clearState":
      self = .clearState(path: (try? c.decode(String.self, forKey: .path)) ?? "")
    case "callEndpoint":
      self = .callEndpoint(
        method: (try? c.decode(String.self, forKey: .method)) ?? "GET",
        path: (try? c.decode(String.self, forKey: .path)) ?? "",
        body: try? c.decode(KBJSON.self, forKey: .body),
        assignTo: try? c.decode(String.self, forKey: .assignTo),
        onSuccess: try? c.decode(KBActionRef.self, forKey: .onSuccess),
        onError: try? c.decode(KBActionRef.self, forKey: .onError)
      )
    case "analytics.track":
      self = .analyticsTrack(
        event: (try? c.decode(String.self, forKey: .event)) ?? "",
        props: try? c.decode(KBJSON.self, forKey: .props)
      )
    case "log":
      self = .log(
        message: (try? c.decode(String.self, forKey: .message)) ?? "",
        level: (try? c.decode(String.self, forKey: .level)) ?? "info"
      )
    case "clearCache":
      self = .clearCache
    case "reloadApp":
      self = .reloadApp
    case "sequence":
      self = .sequence(actions: (try? c.decode([KBActionRef].self, forKey: .actions)) ?? [])
    case "parallel":
      self = .parallel(actions: (try? c.decode([KBActionRef].self, forKey: .actions)) ?? [])
    case "condition":
      // Fall back to a no-op when if/then are absent/malformed instead of
      // throwing (which would drop the whole tree). `else` stays optional.
      guard let cond = try? c.decode(KBCondition.self, forKey: .ifCond),
            let thenA = try? c.decode(KBActionRef.self, forKey: .then) else {
        self = .unknown(kind: "condition"); return
      }
      let elseA = try? c.decode(KBActionRef.self, forKey: .elseRef)
      self = .condition(ifCond: cond, then: thenA, elseRef: elseA)
    case "delay":
      self = .delay(ms: (try? c.decode(Double.self, forKey: .ms)) ?? 0)
    case "extension":
      self = .extensionAction(
        name: (try? c.decode(String.self, forKey: .name)) ?? "",
        params: try? c.decode(KBJSON.self, forKey: .params)
      )
    default:
      self = .unknown(kind: kind)
    }
  }
}

/// Condition mirrors the RN evaluator: {eq}, {neq}, {gt}, {gte}, {lt}, {lte},
/// {in}, {contains}, {truthy}, {falsy}, {flag}, {platform}, {not}, {all}, {any}.
indirect enum KBCondition: Decodable {
  case eq(path: String, value: KBJSON)
  case neq(path: String, value: KBJSON)
  case gt(path: String, value: Double)
  case gte(path: String, value: Double)
  case lt(path: String, value: Double)
  case lte(path: String, value: Double)
  case inList(path: String, values: [KBJSON])
  case contains(path: String, needle: String)
  case startsWith(path: String, prefix: String)
  case endsWith(path: String, suffix: String)
  case truthy(path: String)
  case falsy(path: String)
  case flag(name: String)
  case platform(name: String)
  case not(inner: KBCondition)
  case all(conds: [KBCondition])
  case any_(conds: [KBCondition])
  case unknown

  init(from decoder: Decoder) throws {
    // Conditions are a discriminator-less "first key wins" shape; peek at each
    // possible key. Only one of them will be present per condition.
    let raw = try decoder.singleValueContainer().decode([String: KBJSON].self)
    if let arr = raw["eq"]?.asArray, arr.count == 2, let p = arr[0].asString {
      self = .eq(path: p, value: arr[1]); return
    }
    if let arr = raw["neq"]?.asArray, arr.count == 2, let p = arr[0].asString {
      self = .neq(path: p, value: arr[1]); return
    }
    if let arr = raw["gt"]?.asArray, arr.count == 2, let p = arr[0].asString, let n = arr[1].asDouble {
      self = .gt(path: p, value: n); return
    }
    if let arr = raw["gte"]?.asArray, arr.count == 2, let p = arr[0].asString, let n = arr[1].asDouble {
      self = .gte(path: p, value: n); return
    }
    if let arr = raw["lt"]?.asArray, arr.count == 2, let p = arr[0].asString, let n = arr[1].asDouble {
      self = .lt(path: p, value: n); return
    }
    if let arr = raw["lte"]?.asArray, arr.count == 2, let p = arr[0].asString, let n = arr[1].asDouble {
      self = .lte(path: p, value: n); return
    }
    if let arr = raw["in"]?.asArray, arr.count == 2, let p = arr[0].asString, let vs = arr[1].asArray {
      self = .inList(path: p, values: vs); return
    }
    if let arr = raw["contains"]?.asArray, arr.count == 2, let p = arr[0].asString, let s = arr[1].asString {
      self = .contains(path: p, needle: s); return
    }
    if let arr = raw["startsWith"]?.asArray, arr.count == 2, let p = arr[0].asString, let s = arr[1].asString {
      self = .startsWith(path: p, prefix: s); return
    }
    if let arr = raw["endsWith"]?.asArray, arr.count == 2, let p = arr[0].asString, let s = arr[1].asString {
      self = .endsWith(path: p, suffix: s); return
    }
    if let p = raw["truthy"]?.asString { self = .truthy(path: p); return }
    if let p = raw["falsy"]?.asString  { self = .falsy(path: p); return }
    if let n = raw["flag"]?.asString   { self = .flag(name: n); return }
    if let n = raw["platform"]?.asString { self = .platform(name: n); return }
    if let inner = raw["not"] {
      let data = try JSONEncoderSafe.data(for: inner)
      let dec = try JSONDecoder().decode(KBCondition.self, from: data)
      self = .not(inner: dec); return
    }
    if let arr = raw["all"]?.asArray {
      var out: [KBCondition] = []
      for v in arr {
        let data = try JSONEncoderSafe.data(for: v)
        out.append(try JSONDecoder().decode(KBCondition.self, from: data))
      }
      self = .all(conds: out); return
    }
    if let arr = raw["any"]?.asArray {
      var out: [KBCondition] = []
      for v in arr {
        let data = try JSONEncoderSafe.data(for: v)
        out.append(try JSONDecoder().decode(KBCondition.self, from: data))
      }
      self = .any_(conds: out); return
    }
    self = .unknown
  }
}

/// Serialize a KBJSON back to Data so `not`/`all`/`any` can recursively decode
/// their inner Condition. KBJSON isn't Encodable directly, so we lower it to
/// Foundation types and hand to JSONSerialization.
enum JSONEncoderSafe {
  static func data(for value: KBJSON) throws -> Data {
    let obj = lower(value)
    return try JSONSerialization.data(withJSONObject: obj, options: .fragmentsAllowed)
  }
  /// Public so callers (analytics tombstone, arbitrary JSON side-channels) can
  /// convert a KBJSON to a JSON-friendly Any for further processing.
  static func lower(_ v: KBJSON) -> Any {
    switch v {
    case .null: return NSNull()
    case .bool(let b): return b
    case .number(let n): return n
    case .string(let s): return s
    case .array(let a): return a.map { lower($0) }
    case .object(let o):
      var out: [String: Any] = [:]
      for (k, x) in o { out[k] = lower(x) }
      return out
    }
  }
}

// MARK: - State

/// Small state store. Actions mutate this and call stateChanged() to re-render.
/// Anything readable here is bind-able + visibleIf-able from the backend tree,
/// which is what lets us push changes without rebuilding — the more state we
/// expose, the more the backend can control without a Swift release.
final class KBState {
  var shift: Bool = false
  var capsLock: Bool = false
  var layoutId: String = ""
  var dictating: Bool = false
  var refining: Bool = false
  var hasFullAccess: Bool = false
  var status: String = ""
  var micLevel: CGFloat = 0
  var suggestions: [String] = []
  /// Tone the tools-bar pill cycles through. Values chosen server-side via
  /// config.flags["kb.tones"] or the default set below when unset.
  var tone: String = "Neutral"
  /// True while space is held long enough to enter trackpad-cursor mode. When
  /// true, other keys visually dim and touch tracking on space becomes cursor
  /// movement instead of insertion.
  var trackpadActive: Bool = false
  // -------- OS-derived state exposed to the backend tree --------------------
  // These read via bind: { text: "primaryLanguage" } / visibleIf conditions,
  // so backend can drive things like "show EN when multi-keyboard, else space"
  // WITHOUT needing new Swift logic. Kept in sync by reflectFieldContext().
  /// Two-letter primary language code (e.g. "EN"). Follows the active input mode.
  var primaryLanguage: String = "EN"
  /// True when the user has more than one keyboard installed (needsInputModeSwitchKey).
  var hasMultipleKeyboards: Bool = false
  /// Current appearance — "dark" or "light". Follows userInterfaceStyle.
  var appearance: String = "dark"
  // -------- Backend-scratch dict ------------------------------------------
  // Free-form key/value store the backend owns. setState/toggleState/etc.
  // write here; bind + visibleIf read from state.user.<key>. This is what lets
  // backend compose behaviors ("if state.user.mode == 'search' then …") without
  // needing new Swift for every new flag.
  var user: [String: KBJSON] = [:]
  // -------- Device / environment (populated at init + refreshed on demand) -
  var deviceModel: String = ""
  var systemVersion: String = ""
  var isNetworkReachable: Bool = true
  var keyboardHeight: CGFloat = 0
}

/// Snapshot of the subset of KBState fields that affect layout structure vs
/// pure surface (letter case). Used by stateChanged() to decide whether a
/// change is safe to apply via the fast-shift path (in-place setTitle on
/// letter buttons) or requires a full remount.
struct KBStateSnapshot {
  let shift: Bool
  let capsLock: Bool
  let layoutId: String
  let dictating: Bool
  let refining: Bool
  let hasFullAccess: Bool
  let status: String
  let tone: String
  let trackpadActive: Bool
  let primaryLanguage: String
  let hasMultipleKeyboards: Bool
  let appearance: String

  static func from(_ s: KBState) -> KBStateSnapshot {
    KBStateSnapshot(
      shift: s.shift,
      capsLock: s.capsLock,
      layoutId: s.layoutId,
      dictating: s.dictating,
      refining: s.refining,
      hasFullAccess: s.hasFullAccess,
      status: s.status,
      tone: s.tone,
      trackpadActive: s.trackpadActive,
      primaryLanguage: s.primaryLanguage,
      hasMultipleKeyboards: s.hasMultipleKeyboards,
      appearance: s.appearance
    )
  }

  /// True when the only difference from `other` is shift and/or capsLock —
  /// safe to apply via in-place setTitle on letter buttons without a full
  /// tree rebuild.
  func isShiftOnlyDelta(from other: KBStateSnapshot) -> Bool {
    layoutId == other.layoutId &&
    dictating == other.dictating &&
    refining == other.refining &&
    hasFullAccess == other.hasFullAccess &&
    status == other.status &&
    tone == other.tone &&
    trackpadActive == other.trackpadActive &&
    primaryLanguage == other.primaryLanguage &&
    hasMultipleKeyboards == other.hasMultipleKeyboards &&
    appearance == other.appearance &&
    (shift != other.shift || capsLock != other.capsLock)
  }
}

// MARK: - Renderer

/// Weak-forwarding target for gesture recognizers. A UIGestureRecognizer retains
/// its target STRONGLY; pointing one straight at the renderer (which strongly
/// owns the view tree the GR lives in) forms a retain cycle
/// renderer → tree → button → GR → renderer that keeps the renderer — and its
/// timers — alive after the keyboard dismisses, so deinit never runs and the
/// whole tree leaks in a ~48MB extension. This proxy holds the renderer weakly
/// and forwards the callback, so the only strong edge is button → GR → proxy and
/// the renderer deallocs normally. (UIControl target-action already stores its
/// target unretained, so only the GRs need this.)
final class WeakGRProxy: NSObject {
  private weak var target: NSObject?
  private let selector: Selector
  init(target: NSObject, selector: Selector) {
    self.target = target
    self.selector = selector
  }
  @objc func handle(_ gr: UIGestureRecognizer) {
    guard let target = target, target.responds(to: selector) else { return }
    _ = target.perform(selector, with: gr)
  }
}

final class SDUIRenderer: NSObject {
  private weak var host: KBHostControllerProtocol?
  // var (not let) so a freshly-fetched config can be swapped into the LIVE
  // renderer via updateConfig() — without it, a backend deploy could never
  // reach a running keyboard, only a future extension-process launch.
  private var config: KBConfig
  private let state = KBState()

  /// The container view we mount into (owned by the host controller).
  private weak var mountContainer: UIView?
  /// The single root subview we produce so we can swap it whole on re-render.
  private var mountedRoot: UIView?
  /// Optional multi-touch typing layer (kb.keyPlane.enabled). Rebuilt with the
  /// tree so its key frames always match the freshly-mounted buttons.
  private weak var keyPlane: KeyPlaneView?

  private var lastShiftTapTime: TimeInterval = 0
  private var _lastSpaceTapTime: TimeInterval = 0
  private var _trackpadAnchor: CGFloat = 0
  private var _trackpadOffset: Int = 0
  private var deleteTimer: Timer?
  private var deleteRepeatCount: Int = 0
  // Timer + [weak self] avoids the retain cycle CADisplayLink would create
  // (it retains its target). Renderer is held by the controller and needs to
  // die when the keyboard extension dismisses.
  private var waveformTimer: Timer?
  private weak var waveformView: WaveformView?

  init(controller: KBHostControllerProtocol, config: KBConfig) {
    self.host = controller
    self.config = config
    super.init()
    self.state.hasFullAccess = controller.hostHasFullAccess
    self.state.layoutId = config.layouts?.first?.language ?? ""
    self.state.primaryLanguage = controller.hostPrimaryLanguageCode()
    self.state.hasMultipleKeyboards = controller.hostNeedsInputModeSwitchKey()
    self.state.deviceModel = UIDevice.current.model
    self.state.systemVersion = UIDevice.current.systemVersion
    // state.appearance follows the trait collection; can't read here reliably
    // because the controller may not be attached to a window yet.
  }

  // MARK: Dark/light adaptation

  /// The current appearance the host is in — dark or light. Read from the
  /// host controller's trait collection so the picker below matches whatever
  /// UIVisualEffectView is actually rendering the backdrop.
  private var currentAppearance: UIUserInterfaceStyle {
    (host as? UIViewController)?.traitCollection.userInterfaceStyle ?? .dark
  }

  /// Pick between config.themeDark / themeLight based on the current
  /// appearance. Falls back to config.theme when the adaptive palettes are
  /// absent (backend hasn't emitted them yet). Every color read in the
  /// renderer routes through this so a trait-collection change picks up
  /// automatically on remount().
  var theme: KBTheme? {
    if currentAppearance == .light, let l = config.themeLight { return l }
    if currentAppearance == .dark, let d = config.themeDark { return d }
    return config.theme
  }

  /// Called by the host controller from traitCollectionDidChange. Re-applies
  /// the backdrop with the new blur style and rebuilds the tree so keys pick
  /// up the new palette. Also syncs state.appearance so backend bind/visibleIf
  /// can key off dark vs light without shipping two Swift builds.
  func appearanceDidChange() {
    state.appearance = currentAppearance == .light ? "light" : "dark"
    if let container = mountContainer { applyRootBackground(to: container) }
    remount()
  }

  // MARK: Mount

  /// Attach the renderer to a container view. Called once by the host
  /// controller after it decides SDUI mode is active.
  func mount(into container: UIView) {
    mountContainer = container
    // Apply theme.backgroundEffect / backgroundColor to the container itself.
    applyRootBackground(to: container)
    remount()
  }

  /// Swap in a freshly-fetched config and rebuild the tree in place. This is the
  /// missing piece that let backend edits reach a LIVE keyboard: the host calls
  /// it whenever a config refetch returns, so a deploy + cache bump takes effect
  /// on the current session (after the refetch) instead of only on a future
  /// extension-process launch — which iOS schedules unpredictably. State
  /// (dictating, shift, tone…) is preserved; only the tree + theme are rebuilt.
  func updateConfig(_ newConfig: KBConfig) {
    // Short-circuit when nothing changed: the per-appearance refetch returns the
    // SAME cacheVersion most of the time, and a no-op remount still cancels any
    // in-flight key touch (silent dropped keystroke). Only rebuild on a real bump.
    if let old = config.cacheVersion, let new_ = newConfig.cacheVersion, old == new_ {
      return
    }
    config = newConfig
    // If the active layout no longer exists in the new config, fall back to its
    // first layout so remount() has a valid layoutId to render.
    if let layouts = newConfig.layouts,
       !layouts.contains(where: { $0.language == state.layoutId }) {
      state.layoutId = layouts.first?.language ?? state.layoutId
    }
    if let container = mountContainer { applyRootBackground(to: container) }
    remountWhenIdle()
  }

  /// Remount, but never mid-touch: swapping the tree under an active finger
  /// cancels the in-flight UIControl touch (dropped keystroke) and can let the
  /// detached KeyPlaneView commit a key from the old tree. Wait for the plane
  /// to go idle (bounded retries so a rest-a-finger user can't stall forever).
  private var pendingRemountRetries = 0
  private func remountWhenIdle() {
    if keyPlane?.hasActiveTouches == true, pendingRemountRetries < 20 {
      pendingRemountRetries += 1
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
        self?.remountWhenIdle()
      }
      return
    }
    pendingRemountRetries = 0
    remount()
  }

  /// Tear down the current subview and rebuild from the root node. Cheap: the
  /// keyboard tree is tiny (~40 nodes).
  private func remount() {
    guard let container = mountContainer, let root = config.root else { return }
    // An open tone sheet would be buried alive by the fresh tree (it and its
    // scrim are siblings of mountedRoot): invisible, unresponsive, and leaked
    // until the next present. Close it before rebuilding.
    dismissToneSheet(animated: false)
    mountedRoot?.removeFromSuperview()
    keyPlane?.removeFromSuperview()   // rebuilt below if kb.keyPlane.enabled
    // Drop any visible key-pop balloon so a mid-touch rebuild can't orphan it
    // pointing at a now-deallocated key (it's re-created lazily on next press).
    calloutView?.removeFromSuperview()
    calloutView = nil
    // Reset the fast-shift ref maps — they'll be repopulated as the fresh
    // tree renders. Keeping stale refs would leak old buttons and cause
    // the fast path to call setTitle on removed subviews.
    letterButtonsByChar.removeAll(keepingCapacity: true)
    weakShiftButton = nil
    let v = render(node: root)
    v.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(v)
    NSLayoutConstraint.activate([
      v.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      v.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      v.topAnchor.constraint(equalTo: container.topAnchor),
      v.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
    mountedRoot = v
    // If a recording is in progress, the tree we just rebuilt has a fresh
    // tools row that needs to be brought back above the dim overlay, and the
    // emitter's saved emitterPosition points at the OLD mic center (deallocated
    // with the previous tree). Re-anchor both.
    if state.dictating, recordingDimView != nil {
      if let mic = currentMicButton?.superview {
        container.bringSubviewToFront(mic)
      }
      // Move emitter to the new mic position so dots keep flowing from the
      // right place. Only reposition; we don't restart the birthrate.
      if let emitter = dotStreamLayer,
         let mic = currentMicButton, let micSuper = mic.superview {
        emitter.emitterPosition = micSuper.convert(mic.center, to: container)
      }
    }

    // Multi-touch typing layer. ON by default now — it's the smooth path: it
    // sits above the tree and owns touch for the single-character keys (letters
    // + number/symbol glyphs), turning the per-button target-action grid into a
    // real rolling/multi-touch plane. Without it, letter keys commit only on a
    // clean touchUpInside of the exact button, so a fast tap that drifts a few
    // points becomes touchUpOutside and the key is DROPPED — which reads as
    // "have to type hard / deliberately." The plane commits the key under the
    // finger at release and tolerates roll/drift, so quick light taps register
    // like the system keyboard. Buttons stay pure visuals (fast-shift, flash,
    // theming untouched); space bar + tone pill are excluded so their special
    // handling survives. OTA-reversible: backend sets kb.keyPlane.enabled=false
    // to fall back to the per-button grid (which restores accent long-press
    // trays, the one thing the v1 plane doesn't route yet).
    if flagBool("kb.keyPlane.enabled", true) {
      let planeKeys: [KeyPlaneView.Key] = letterButtonsByChar.compactMap { char, btn in
        guard !char.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        btn.isUserInteractionEnabled = false   // plane owns its touches now
        return KeyPlaneView.Key(button: btn, char: char)
      }
      if !planeKeys.isEmpty {
        let plane = KeyPlaneView(keys: planeKeys, renderer: self)
        plane.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(plane)   // topmost — intercepts char touches only
        NSLayoutConstraint.activate([
          plane.leadingAnchor.constraint(equalTo: container.leadingAnchor),
          plane.trailingAnchor.constraint(equalTo: container.trailingAnchor),
          plane.topAnchor.constraint(equalTo: container.topAnchor),
          plane.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        keyPlane = plane
      }
    }
    // Build stamp — added LAST so it sits on top of the tree + plane. A small
    // corner marker that proves whether THIS binary is the one running: if iOS
    // is serving a cached old keyboard extension (the usual reason "updates do
    // nothing"), you won't see it. Bump `buildStamp` every build. Hide via
    // kb.buildStamp.enabled=false once delivery is confirmed working.
    addBuildStamp(to: container)
  }

  /// Bump this string on every build so the on-screen marker changes — that's
  /// how you tell a freshly-loaded extension from a cached old one.
  private static let buildStamp = "K1"
  private weak var buildStampLabel: UILabel?
  private func addBuildStamp(to container: UIView) {
    // Default FALSE: a debug marker must never ship visible in a store build
    // (with default true it appeared on offline first-run / any config miss).
    // To verify a new binary loaded, flip kb.buildStamp.enabled=true on the
    // backend (OTA) — the stamp appearing then proves BOTH the binary carries
    // this code AND live config delivery works — and flip it back off after.
    guard flagBool("kb.buildStamp.enabled", false) else { return }
    buildStampLabel?.removeFromSuperview()
    let l = UILabel()
    l.text = Self.buildStamp
    l.font = .systemFont(ofSize: 9, weight: .heavy)
    l.textColor = UIColor.systemOrange.withAlphaComponent(0.9)
    l.isUserInteractionEnabled = false   // never intercepts key touches
    l.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(l)
    container.bringSubviewToFront(l)
    NSLayoutConstraint.activate([
      l.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -5),
      l.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -3),
    ])
    buildStampLabel = l
  }

  /// Public hook — actions call this after mutating KBState.
  /// Deferred + coalesced remount. Multiple `stateChanged()` calls in the
  /// same runloop collapse to a single rebuild scheduled on the next tick,
  /// so touch handlers (insertText, delete, shift toggle, autocap arm) return
  /// immediately instead of blocking on the full tree teardown/rebuild. That
  /// blocking rebuild was the root of the "touch delay" — on complex trees
  /// each remount cost 30-80ms and fired synchronously inside the tap
  /// handler; iOS therefore didn't process the next tap until the rebuild
  /// finished. This coalesced-async model completes the current tap first,
  /// commits the character to the field, THEN rebuilds visuals.
  ///
  /// FAST PATH: when the ONLY delta since the last render is state.shift /
  /// state.capsLock (autoCap arm, one-shot shift release), skip the full
  /// remount and mutate letter labels in place. That's every-other-keystroke
  /// in sentences mode + roughly-every-keystroke on word/character caps.
  /// The full remount runs when layoutId/dictating/refining/tone/other
  /// diffs are present, or when we haven't tracked the previous snapshot.
  private var pendingRemount: Bool = false
  private var letterButtonsByChar: [String: UIButton] = [:]
  private var weakShiftButton: UIButton?
  private var lastRenderSnapshot: KBStateSnapshot?

  func stateChanged() {
    let currentSnap = KBStateSnapshot.from(state)
    if let last = lastRenderSnapshot,
       currentSnap.isShiftOnlyDelta(from: last),
       !letterButtonsByChar.isEmpty {
      applyFastShiftUpdate(uppercased: currentSnap.shift || currentSnap.capsLock)
      lastRenderSnapshot = currentSnap
      return
    }
    if pendingRemount { return }
    pendingRemount = true
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.pendingRemount = false
      self.remount()
      self.lastRenderSnapshot = KBStateSnapshot.from(self.state)
    }
  }

  /// In-place letter case swap + shift icon refresh. Runs synchronously
  /// (safe — it's a title mutation, cheap) so the shift key visually flips
  /// on the same runloop as the next keystroke.
  private func applyFastShiftUpdate(uppercased: Bool) {
    for (ch, btn) in letterButtonsByChar {
      btn.setTitle(uppercased ? ch.uppercased() : ch.lowercased(), for: .normal)
    }
    if let shift = weakShiftButton {
      applyShiftKeyVisual(shift)
    }
  }

  // MARK: Root backdrop

  /// The theme's `backgroundEffect` sits on the container itself (not on the
  /// root node) so blur / gradient covers the whole keyboard area.
  ///
  /// IMPORTANT: we do NOT paint container.backgroundColor from theme.background
  /// as an opaque layer — that was making the blur backdrop useless (it was
  /// frosting a solid black rectangle instead of the OS keyboard region behind
  /// it). Native iOS keyboards let the underlying region show through the blur
  /// so keys read as "floating on frosted glass" instead of sitting on a slab.
  /// theme.background is kept as a *fallback* color, applied only when no
  /// backgroundEffect is set — that way older client builds without the blur
  /// still get a solid backdrop.
  private func applyRootBackground(to container: UIView) {
    if theme?.backgroundEffect == nil, let bg = theme?.background {
      container.backgroundColor = UIColor(tulmiHex: bg)
    } else {
      container.backgroundColor = .clear
    }
    guard let effect = theme?.backgroundEffect else { return }
    // Remove any previous backdrop we installed.
    container.subviews
      .filter { $0.tag == Self.backdropTag }
      .forEach { $0.removeFromSuperview() }
    let backdrop = makeEffectBackdrop(effect: effect)
    backdrop.tag = Self.backdropTag
    backdrop.translatesAutoresizingMaskIntoConstraints = false
    container.insertSubview(backdrop, at: 0)
    NSLayoutConstraint.activate([
      backdrop.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      backdrop.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      backdrop.topAnchor.constraint(equalTo: container.topAnchor),
      backdrop.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
  }
  private static let backdropTag: Int = 0x7B00D_1_A

  // MARK: - Node dispatch

  /// Walk a node into a UIView. `visibleIf` culls the subtree; unknown types
  /// render a red "?" tile so schema mismatches are visible instead of silent.
  func render(node: KBNode) -> UIView {
    if let cond = node.visibleIf, !evaluate(cond) {
      let empty = UIView()
      empty.isHidden = true
      return empty
    }
    let v: UIView
    switch node.type {
    case "Container", "Column": v = buildStack(node: node, axis: .vertical)
    case "Row":                  v = buildStack(node: node, axis: .horizontal)
    case "Spacer":               v = buildSpacer(node: node)
    case "LetterKey":            v = buildLetterKey(node: node)
    case "IconKey":              v = buildIconKey(node: node)
    // Generic components — every one of these means "backend can add richer UI
    // without shipping new Swift." Keep additions here in sync with buildXxx.
    case "TextLabel":            v = buildTextLabel(node: node)
    case "Image":                v = buildImageNode(node: node)
    case "ProgressBar":          v = buildProgressBar(node: node)
    case "Toggle":               v = buildToggleNode(node: node)
    case "ScrollView":           v = buildScrollView(node: node)
    case "SpaceKey":             v = buildSpaceKey(node: node)
    case "ShiftKey":             v = buildShiftKey(node: node)
    case "ReturnKey":            v = buildReturnKey(node: node)
    case "BackspaceKey":         v = buildBackspaceKey(node: node)
    case "GlobeKey":             v = buildGlobeKey(node: node)
    case "MicKey":               v = buildMicKey(node: node)
    case "RefineKey":            v = buildRefineKey(node: node)
    case "SuggestionBar":        v = buildSuggestionBar(node: node)
    case "Waveform":             v = buildWaveform(node: node)
    case "StatusLabel":          v = buildStatusLabel(node: node)
    case "Divider":              v = buildDivider(node: node)
    case "BlurBackdrop":         v = buildBlurBackdrop(node: node)
    default:                     v = buildUnknown(type: node.type)
    }
    applyStyle(node: node, to: v)
    applyEffectIfChildlessBackdrop(node: node, view: v)
    return v
  }

  // MARK: - Components

  /// Container / Row / Column all lower to UIStackView. Row = horizontal.
  /// If the node has an `effect` too, `applyEffectIfChildlessBackdrop` inserts
  /// it as a background subview at layer index 0 — UIStackView still lays out
  /// its arrangedSubviews above it.
  ///
  /// Proportional flex: children with a numeric `flex` on their style get a
  /// widthAnchor (row) / heightAnchor (column) constraint whose multiplier is
  /// their `flex / totalFlex` share of the stack's usable size. That's what
  /// makes space:5.79 actually occupy 5.79× a letter key's width instead of
  /// tied-with-everything-at-defaultLow behavior. Explicit `width` still wins
  /// over flex when both are set.
  private func buildStack(node: KBNode, axis: NSLayoutConstraint.Axis) -> UIView {
    // Horizontal stacks (= key rows) use KeyRowStackView so a tap in the gap
    // between two keys routes to the nearest key instead of being lost. Keys
    // fill the row height (alignment .fill), so there is no vertical gap WITHIN
    // a row — dividing the horizontal gaps reclaims all the wasted touch area.
    // Vertical stacks stay plain UIStackView (routing across rows would send a
    // near-miss to the wrong row, which is worse than the small inter-row gap).
    let stack = axis == .horizontal ? KeyRowStackView() : UIStackView()
    if let keyRow = stack as? KeyRowStackView {
      keyRow.gapRoutingEnabled = flagBool("kb.row.expandHitTargets", true)
    }
    stack.axis = axis
    stack.alignment = .fill
    stack.distribution = .fill
    stack.spacing = CGFloat(node.style?["gap"]?.asDouble ?? node.style?["spacing"]?.asDouble ?? 5)

    let kids = node.children ?? []
    var built: [(node: KBNode, view: UIView)] = []
    for child in kids {
      let cv = render(node: child)
      stack.addArrangedSubview(cv)
      built.append((child, cv))
    }

    // Second pass: apply proportional flex constraints. Sum every child's flex
    // (default 0). If the total is > 0 AND the child has flex but no explicit
    // width/height in its dimension, tie its size to a reference child (the
    // first flex sibling) at the ratio flex_i / flex_ref.
    let flexes: [Double] = built.map { $0.node.style?["flex"]?.asDouble ?? 0 }
    let sizeKey = axis == .horizontal ? "width" : "height"
    let hasSizeInAxis: [Bool] = built.map { $0.node.style?[sizeKey]?.asCGFloat != nil }
    // Find the first flex>0 child that DOESN'T have explicit size — becomes the
    // ratio anchor.
    let refIndex = flexes.enumerated().first { (i, f) in f > 0 && !hasSizeInAxis[i] }?.offset
    if let ref = refIndex {
      let refFlex = flexes[ref]
      let refView = built[ref].view
      for i in 0..<built.count {
        guard i != ref else { continue }
        let f = flexes[i]
        if f <= 0 { continue }             // no flex → intrinsic / explicit width
        if hasSizeInAxis[i] { continue }   // explicit width wins
        let child = built[i].view
        let ratio = CGFloat(f / refFlex)
        if axis == .horizontal {
          child.widthAnchor.constraint(equalTo: refView.widthAnchor, multiplier: ratio).isActive = true
        } else {
          child.heightAnchor.constraint(equalTo: refView.heightAnchor, multiplier: ratio).isActive = true
        }
      }
    }
    return stack
  }

  /// An empty view that consumes remaining space in the parent stack, letting
  /// siblings hug their content.
  private func buildSpacer(node: KBNode) -> UIView {
    let v = UIView()
    v.setContentHuggingPriority(.defaultLow, for: .horizontal)
    v.setContentHuggingPriority(.defaultLow, for: .vertical)
    v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    v.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
    return v
  }

  /// Letter key — the workhorse. Title honors shift/capsLock; tap inserts.
  /// Long-press (500ms) reveals an accent tray for letters that have one
  /// (English: a e i o u n c y s d h; Latin extended can be added by locale).
  /// When `bind.content` names a KBState key (e.g. "tone"), the title reads
  /// from that key at render time — used for the tone pill in the tools bar.
  private func buildLetterKey(node: KBNode) -> UIView {
    var ch = node.props?["char"]?.asString ?? ""
    if let boundKey = node.bind?["content"], let live = stateValue(for: boundKey) {
      ch = live
    }
    let btn = makeKeyButton()
    // Tone pill registration for the dictation dot stream — the pill is the
    // one LetterKey whose bind.content resolves to the "tone" state field, so
    // this identifies it uniquely without a per-node id.
    if node.bind?["content"] == "tone" {
      currentToneButton = btn
      // Hold the tone pill → a tone sheet springs out of it (keyboard frosts
      // behind it) so the user can jump straight to any tone instead of tapping
      // to cycle. Live SDUI path — this is the control the user actually sees
      // (the hand-built TulmiPersonalityRow sheet never mounts when sdui=true).
      // List comes from configuredTones() (backend kb.tones); the whole gesture
      // is disableable via kb.tone.sheet.enabled=false. cancelsTouchesInView
      // (default true) suppresses the cycle-tap once the hold recognizes.
      if flagBool("kb.tone.sheet.enabled", true) {
        let lp = UILongPressGestureRecognizer(
          target: WeakGRProxy(target: self, selector: #selector(toneSheetLongPress(_:))),
          action: #selector(WeakGRProxy.handle(_:)))
        lp.minimumPressDuration = flagDouble("kb.tone.sheet.longPressMs", 300) / 1000.0
        lp.allowableMovement = 500
        btn.addGestureRecognizer(lp)
      }
    }
    let uppercased = state.shift || state.capsLock
    // Only apply case swap for single-character labels — multi-char titles
    // (like "Neutral") stay as-is regardless of shift.
    let displayed = ch.count == 1 ? (uppercased ? ch.uppercased() : ch.lowercased()) : ch
    btn.setTitle(displayed, for: .normal)
    // Register single-char letter buttons for the fast-shift path so
    // stateChanged() can update them in place without a full remount.
    if ch.count == 1 && node.bind?["content"] != "tone" {
      letterButtonsByChar[ch.lowercased()] = btn
    }
    // Bake the BASE char (not the currently-cased one). The fast-shift path
    // (applyFastShiftUpdate) only re-titles the button in place; it does NOT
    // rebuild this action. If we baked the case here, a shift toggle would flip
    // the visible title but leave the OLD case in the tap action → keys insert
    // the wrong case (e.g. display "A" but type "a", or type "HELLO" for
    // "Hello"). run(.insertKey) applies the live state.shift/capsLock case at
    // tap time instead, so title and inserted text always agree.
    let payload = node.props?["char"]?.asString ?? ch
    bindTap(btn, node: node, defaultAction: .insertKey(char: payload))

    // Attach an accent popover if this letter has one in the map.
    if let accents = accentMap[ch.lowercased()], !accents.isEmpty {
      let lp = UILongPressGestureRecognizer(
        target: WeakGRProxy(target: self, selector: #selector(letterLongPress(_:))),
        action: #selector(WeakGRProxy.handle(_:)))
      // Backend flag: kb.accentTray.longPressMs (default 500) — hold-to-open threshold
      lp.minimumPressDuration = flagDouble("kb.accentTray.longPressMs", 500) / 1000.0
      lp.allowableMovement = 500
      objc_setAssociatedObject(lp, &Self.accentsKey, accents, .OBJC_ASSOCIATION_RETAIN)
      objc_setAssociatedObject(lp, &Self.accentsBaseKey, ch, .OBJC_ASSOCIATION_RETAIN)
      btn.addGestureRecognizer(lp)
    }
    return btn
  }

  private static var accentsKey: UInt8 = 0
  private static var accentsBaseKey: UInt8 = 0
  private weak var activeAccentTray: UIView?

  /// Read a KBState value by name for a `bind` in the tree. Used by
  /// components (LetterKey) that show live state text (e.g. tone pill).
  /// Every case here is a "backend can drive this without a rebuild" hook.
  private func stateValue(for key: String) -> String? {
    switch key {
    case "tone":                 return state.tone
    case "status":               return state.status
    case "layoutId":             return state.layoutId
    case "primaryLanguage":      return state.primaryLanguage
    case "appearance":           return state.appearance
    case "hasMultipleKeyboards": return state.hasMultipleKeyboards ? "true" : "false"
    case "hasFullAccess":        return state.hasFullAccess ? "true" : "false"
    case "dictating":            return state.dictating ? "true" : "false"
    case "refining":             return state.refining ? "true" : "false"
    case "shift":                return state.shift ? "true" : "false"
    case "capsLock":             return state.capsLock ? "true" : "false"
    default:                     return nil
    }
  }

  // MARK: - Backend-tunable flags (with sane defaults)
  //
  // Every visual constant we add gets a `flag*` accessor so backend can push
  // a config.flags[<key>] override without a native rebuild. Unset → default.
  //
  // Convention: dot.notation keys under "kb.*". Grouped by feature so backend
  // devs can find them.

  private func flagString(_ key: String, _ def: String) -> String {
    config.flags?[key]?.asString ?? def
  }
  private func flagDouble(_ key: String, _ def: Double) -> Double {
    config.flags?[key]?.asDouble ?? def
  }
  private func flagCGFloat(_ key: String, _ def: CGFloat) -> CGFloat {
    CGFloat(config.flags?[key]?.asDouble ?? Double(def))
  }
  private func flagBool(_ key: String, _ def: Bool) -> Bool {
    config.flags?[key]?.asBool ?? def
  }
  private func flagColor(_ key: String, _ def: String) -> UIColor {
    UIColor(tulmiHex: flagString(key, def))
  }
  /// Icon-spec flag — resolves to a UIImage via the same resolver used by
  /// IconKey. Backend can pass { sf: "..." } / { asset: "..." } / { url: "..." }
  /// / { emoji: "..." } / string shorthand.
  private func flagIcon(_ key: String) -> KBJSON? {
    config.flags?[key]
  }

  /// SF Symbol font-weight name → UIImage.SymbolWeight.
  fileprivate func sfWeight(_ raw: String) -> UIImage.SymbolWeight {
    switch raw.lowercased() {
    case "thin":     return .thin
    case "light":    return .light
    case "regular":  return .regular
    case "medium":   return .medium
    case "semibold": return .semibold
    case "bold":     return .bold
    case "heavy":    return .heavy
    case "black":    return .black
    default:         return .regular
    }
  }

  // MARK: - Dictation visual overlay
  //
  // Two visual layers ride on top of the keyboard while state.dictating=true:
  //   1. Key dimming — a translucent black overlay dims the letter/function
  //      key rows, focusing attention on the tools row. Tools row is brought
  //      above the overlay so mic + tone stay bright.
  //   2. Dot stream — a CAEmitterLayer positioned at the mic button center,
  //      emitting orange dots that travel across to the tone pill and fade
  //      out along the way, so the tone pill visually "receives" them.
  //
  // On stop (state.dictating flips to false), the emitter's birthRate is
  // zeroed but the layer stays live for ~2.5s so already-airborne dots
  // complete their journey. Rough coincidence: refine RTT is ~2s, so the
  // last dot dissolves about when the refined text lands in the field.

  private weak var currentMicButton: UIButton?
  private weak var currentToneButton: UIButton?
  private var dotStreamLayer: CAEmitterLayer?
  private weak var recordingDimView: UIView?
  // The mic's physics sim is held STRONGLY (not via the view tree) so it
  // survives the stop→remount and can run its reverse "reassemble into the
  // mark" pass. `micReassembling` keeps buildMicKey rendering the sim (rather
  // than the static mark) for that brief converge window after recording ends.
  private var currentMicParticles: MicParticleView?
  private var micReassembling = false

  private func showRecordingVisuals() {
    // Wait for the remount that stateChanged() scheduled — that's where
    // currentMicButton / currentToneButton get set. Async on main gets us the
    // next runloop tick, by which point the new tree is mounted.
    // Guard against a race: if dictation stopped between reflectDictating(true)
    // and this block running, don't create visuals at all.
    DispatchQueue.main.async { [weak self] in
      guard let self = self, self.state.dictating else { return }
      self.applyKeyDimming()
      self.startDotStream()
    }
  }

  private func hideRecordingVisuals() {
    fadeOutDotStream()
    removeKeyDimming()
  }

  private func applyKeyDimming() {
    // Backend flags:
    //   kb.dictation.dim.enabled  (default true)  — set false to skip the dim entirely
    //   kb.dictation.dim.color    (default "#000000")
    //   kb.dictation.dim.alpha    (default 0.45)  — 0..1 opacity of the dim overlay
    //   kb.dictation.dim.fadeMs   (default 250)   — fade-in duration
    guard flagBool("kb.dictation.dim.enabled", true) else { return }
    guard let container = mountContainer, recordingDimView == nil else { return }
    let dim = UIView()
    dim.translatesAutoresizingMaskIntoConstraints = false
    dim.backgroundColor = flagColor("kb.dictation.dim.color", "#000000")
      .withAlphaComponent(flagCGFloat("kb.dictation.dim.alpha", 0.45))
    dim.isUserInteractionEnabled = false
    dim.alpha = 0
    container.addSubview(dim)
    NSLayoutConstraint.activate([
      dim.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      dim.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      dim.topAnchor.constraint(equalTo: container.topAnchor),
      dim.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
    if let mic = currentMicButton?.superview { container.bringSubviewToFront(mic) }
    let fadeMs = flagDouble("kb.dictation.dim.fadeMs", 250)
    UIView.animate(withDuration: fadeMs / 1000.0) { dim.alpha = 1 }
    recordingDimView = dim
  }

  private func removeKeyDimming() {
    guard let dim = recordingDimView else { return }
    let fadeMs = flagDouble("kb.dictation.dim.fadeMs", 250)
    UIView.animate(withDuration: fadeMs / 1000.0, animations: { dim.alpha = 0 },
                   completion: { _ in dim.removeFromSuperview() })
    recordingDimView = nil
  }

  private func startDotStream() {
    // Backend flags:
    //   kb.dictation.dots.enabled     (default true)      — skip stream entirely
    //   kb.dictation.dots.color       (default "#E8A23C")
    //   kb.dictation.dots.size        (default 14)        — px, diameter of the source image
    //   kb.dictation.dots.birthRate   (default 7)         — dots per second
    //   kb.dictation.dots.lifetimeMs  (default 1800)      — how long each dot lives
    //   kb.dictation.dots.spread      (default 0.08)      — rad, emission fan
    //   kb.dictation.dots.velocityJitter (default 0.05)   — fraction of base velocity
    //   kb.dictation.dots.scale       (default 0.35)      — CAEmitterCell scale
    //   kb.dictation.dots.scaleRange  (default 0.1)
    //   kb.dictation.dots.alphaSpeed  (default -0.55)     — /sec, negative fades
    guard flagBool("kb.dictation.dots.enabled", true) else { return }
    guard let container = mountContainer,
          let mic = currentMicButton, let micSuper = mic.superview,
          let tone = currentToneButton, let toneSuper = tone.superview,
          dotStreamLayer == nil else { return }

    let micCenter = micSuper.convert(mic.center, to: container)
    let toneCenter = toneSuper.convert(tone.center, to: container)

    let emitter = CAEmitterLayer()
    emitter.emitterPosition = micCenter
    emitter.emitterShape = .point
    emitter.emitterMode = .points
    container.layer.addSublayer(emitter)

    let cell = CAEmitterCell()
    cell.contents = makeDotImage().cgImage
    cell.birthRate = Float(flagDouble("kb.dictation.dots.birthRate", 7))
    cell.lifetime = Float(flagDouble("kb.dictation.dots.lifetimeMs", 1800) / 1000.0)
    let dx = toneCenter.x - micCenter.x
    let dy = toneCenter.y - micCenter.y
    let distance = sqrt(dx * dx + dy * dy)
    cell.velocity = distance / CGFloat(cell.lifetime)
    cell.velocityRange = distance * flagCGFloat("kb.dictation.dots.velocityJitter", 0.05)
    cell.emissionLongitude = atan2(dy, dx)
    cell.emissionRange = flagCGFloat("kb.dictation.dots.spread", 0.08)
    cell.scale = flagCGFloat("kb.dictation.dots.scale", 0.35)
    cell.scaleRange = flagCGFloat("kb.dictation.dots.scaleRange", 0.1)
    cell.alphaSpeed = Float(flagDouble("kb.dictation.dots.alphaSpeed", -0.55))
    emitter.emitterCells = [cell]
    dotStreamLayer = emitter
  }

  private func fadeOutDotStream() {
    // Backend flag:
    //   kb.dictation.dots.decayMs  (default 2500) — how long the birth-zeroed
    //   emitter stays live so already-airborne dots complete their journey.
    //   Bump to align the last dot's dissolve with typical refine RTT.
    guard let emitter = dotStreamLayer else { return }
    emitter.emitterCells?.forEach { $0.birthRate = 0 }
    let decayMs = flagDouble("kb.dictation.dots.decayMs", 2500)
    let cleanup = DispatchWorkItem { [weak self] in
      self?.dotStreamLayer?.removeFromSuperlayer()
      self?.dotStreamLayer = nil
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + decayMs / 1000.0, execute: cleanup)
  }

  /// A single dot image, sized + colored from backend flags.
  private func makeDotImage() -> UIImage {
    let size = flagCGFloat("kb.dictation.dots.size", 14)
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
    return renderer.image { ctx in
      flagColor("kb.dictation.dots.color", "#E8A23C").setFill()
      ctx.cgContext.fillEllipse(in: CGRect(origin: .zero, size: CGSize(width: size, height: size)))
    }
  }

  /// Tones the cycleTone action rotates through. Backend can override via
  /// config.flags["kb.tones"] (comma-separated). Default matches the ones
  /// the app's Personality screen uses.
  private func configuredTones() -> [String] {
    if let raw = config.flags?["kb.tones"]?.asString {
      let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
      if !parts.isEmpty { return parts }
    }
    return ["Neutral", "Casual", "Formal", "Excited"]
  }

  // MARK: - Tone sheet (hold the tone pill → pick a tone directly)

  private weak var toneSheetOverlay: UIView?
  private weak var toneSheetBlur: UIVisualEffectView?

  @objc private func toneSheetLongPress(_ gr: UILongPressGestureRecognizer) {
    guard gr.state == .began, let anchor = gr.view as? UIButton else { return }
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    presentToneSheet(anchor: anchor)
  }

  private func presentToneSheet(anchor: UIButton) {
    dismissToneSheet(animated: false)
    guard let host = mountContainer else { return }

    // 1) Frost the keyboard behind the sheet; tap the scrim to dismiss.
    let blur = UIVisualEffectView(effect: nil)
    blur.frame = host.bounds
    blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.addSubview(blur)
    blur.addGestureRecognizer(
      UITapGestureRecognizer(
        target: WeakGRProxy(target: self, selector: #selector(toneScrimTapped(_:))),
        action: #selector(WeakGRProxy.handle(_:))))
    toneSheetBlur = blur

    // 2) The tone list.
    let container = UIView()
    container.backgroundColor = UIColor(white: 0.09, alpha: 0.96)
    container.layer.cornerRadius = 12
    container.layer.shadowColor = UIColor.black.cgColor
    container.layer.shadowOpacity = 0.35
    container.layer.shadowRadius = 12
    container.layer.shadowOffset = CGSize(width: 0, height: 6)
    container.translatesAutoresizingMaskIntoConstraints = false

    let vstack = UIStackView()
    vstack.axis = .vertical
    vstack.spacing = 2
    vstack.translatesAutoresizingMaskIntoConstraints = false
    vstack.isLayoutMarginsRelativeArrangement = true
    vstack.layoutMargins = UIEdgeInsets(top: 6, left: 6, bottom: 6, right: 6)
    container.addSubview(vstack)
    NSLayoutConstraint.activate([
      vstack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      vstack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      vstack.topAnchor.constraint(equalTo: container.topAnchor),
      vstack.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])

    let accent = flagColor("kb.tone.sheet.accent", "#E8A23C")
    for tone in configuredTones() {
      let btn = UIButton(type: .system)
      let isActive = tone.caseInsensitiveCompare(state.tone) == .orderedSame
      btn.setTitle(isActive ? "\(tone)  ✓" : tone, for: .normal)
      btn.setTitleColor(isActive ? accent : .white, for: .normal)
      btn.titleLabel?.font = .systemFont(ofSize: 14, weight: isActive ? .semibold : .medium)
      btn.contentEdgeInsets = UIEdgeInsets(top: 9, left: 16, bottom: 9, right: 16)
      btn.contentHorizontalAlignment = .leading
      let picked = tone
      btn.addAction(UIAction { [weak self] _ in self?.selectTone(picked) }, for: .touchUpInside)
      vstack.addArrangedSubview(btn)
    }

    host.addSubview(container)
    let anchorFrame = anchor.convert(anchor.bounds, to: host)
    // The tone pill sits in the tools row at the TOP of the keyboard, so the
    // sheet DROPS DOWN over the (frosted) keys — going up would render above the
    // keyboard's own frame, where an extension can't draw, and get clipped.
    // Right-align to the pill (it lives on the right) and clamp to the host.
    NSLayoutConstraint.activate([
      container.trailingAnchor.constraint(equalTo: host.leadingAnchor, constant: anchorFrame.maxX),
      container.leadingAnchor.constraint(greaterThanOrEqualTo: host.leadingAnchor, constant: 8),
      container.topAnchor.constraint(equalTo: host.topAnchor, constant: anchorFrame.maxY + 6),
      container.widthAnchor.constraint(greaterThanOrEqualToConstant: 150),
    ])
    toneSheetOverlay = container

    // 3) Suction pop: the sheet is "sucked out" of the pill — starts as a tiny
    // point at the pill and springs to full size.
    host.layoutIfNeeded()
    container.alpha = 0
    container.transform = CGAffineTransform(translationX: 0, y: -10).scaledBy(x: 0.08, y: 0.08)
    UIView.animate(withDuration: 0.16) { blur.effect = UIBlurEffect(style: .systemThinMaterialDark) }
    UIView.animate(
      withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.72, initialSpringVelocity: 0.6,
      options: [.curveEaseOut, .allowUserInteraction],
      animations: { container.alpha = 1; container.transform = .identity })
  }

  @objc private func toneScrimTapped(_ gr: UITapGestureRecognizer) {
    dismissToneSheet(animated: true)
  }

  private func selectTone(_ tone: String) {
    state.tone = tone
    // Publish so the main app's tone-based refine prompt can read it — same
    // side effects as the cycleTone action.
    UserDefaults(suiteName: "group.com.tulmi.app")?.set(tone, forKey: "tulmi.kb.tone")
    fireKeyHaptic()
    dismissToneSheet(animated: true)
    stateChanged()   // remount → the tone pill rebinds to the new state.tone
  }

  private func dismissToneSheet(animated: Bool) {
    let overlay = toneSheetOverlay
    let blur = toneSheetBlur
    toneSheetOverlay = nil
    toneSheetBlur = nil
    guard animated, overlay != nil || blur != nil else {
      overlay?.removeFromSuperview(); blur?.removeFromSuperview(); return
    }
    UIView.animate(
      withDuration: 0.2, delay: 0, options: [.curveEaseIn],
      animations: {
        overlay?.alpha = 0
        overlay?.transform = CGAffineTransform(translationX: 0, y: -10).scaledBy(x: 0.08, y: 0.08)
        blur?.effect = nil
        blur?.alpha = 0
      },
      completion: { _ in overlay?.removeFromSuperview(); blur?.removeFromSuperview() })
  }

  /// English accent map. Order matches Apple's stock keyboard. When a locale
  /// needs a different set, config.flags["kb.accents.<locale>"] can eventually
  /// override this.
  private var accentMap: [String: [String]] {
    [
      "a": ["à", "á", "â", "ä", "æ", "ã", "å", "ā"],
      "e": ["è", "é", "ê", "ë", "ē", "ė", "ę"],
      "i": ["î", "ï", "í", "ī", "į", "ì"],
      "o": ["ô", "ö", "ò", "ó", "œ", "ø", "ō", "õ"],
      "u": ["û", "ü", "ù", "ú", "ū"],
      "y": ["ÿ"],
      "s": ["ß", "ś", "š"],
      "l": ["ł"],
      "z": ["ž", "ź", "ż"],
      "c": ["ç", "ć", "č"],
      "n": ["ñ", "ń"],
      "d": ["ď"],
      "h": ["ĥ", "ħ"],
    ]
  }

  @objc private func letterLongPress(_ gr: UILongPressGestureRecognizer) {
    guard let btn = gr.view as? UIButton else { return }
    let accents = (objc_getAssociatedObject(gr, &Self.accentsKey) as? [String]) ?? []
    let base = (objc_getAssociatedObject(gr, &Self.accentsBaseKey) as? String) ?? ""
    switch gr.state {
    case .began:
      showAccentTray(for: btn, base: base, options: accents)
    case .changed:
      if let tray = activeAccentTray {
        let loc = gr.location(in: tray)
        tray.subviews.forEach { chip in
          let inside = chip.frame.contains(loc)
          if inside { chip.backgroundColor = flagColor("kb.accentTray.chipActiveBg", "#007AFF") }
          else { chip.backgroundColor = keyBgColor() }
        }
      }
    case .ended:
      pickAccentAndDismiss(gestureRecognizer: gr)
    case .cancelled, .failed:
      dismissAccentTray()
    default:
      break
    }
  }

  private func showAccentTray(for anchor: UIButton, base: String, options: [String]) {
    dismissAccentTray()
    guard let container = mountContainer else { return }
    let uppercased = state.shift || state.capsLock
    let items = ([base] + options).map { uppercased ? $0.uppercased() : $0 }

    // Backend flags:
    //   kb.accentTray.chipWidth      (default 40)
    //   kb.accentTray.chipFontSize   (default 22)
    //   kb.accentTray.chipRadius     (default 6)
    //   kb.accentTray.height         (default 48)
    //   kb.accentTray.offsetY        (default -52) — negative = above the key
    //   kb.accentTray.radius         (default 8)
    //   kb.accentTray.padding        (default 4)
    //   kb.accentTray.gap            (default 4)
    let chipW = flagCGFloat("kb.accentTray.chipWidth", 40)
    let chipFont = flagCGFloat("kb.accentTray.chipFontSize", 22)
    let chipRadius = flagCGFloat("kb.accentTray.chipRadius", 6)
    let trayHeight = flagCGFloat("kb.accentTray.height", 48)
    let trayRadius = flagCGFloat("kb.accentTray.radius", 8)
    let trayPad = flagCGFloat("kb.accentTray.padding", 4)
    let gap = flagCGFloat("kb.accentTray.gap", 4)
    let offsetY = flagCGFloat("kb.accentTray.offsetY", -52)

    let tray = UIStackView()
    tray.axis = .horizontal
    tray.distribution = .fillEqually
    tray.alignment = .fill
    tray.spacing = gap
    tray.translatesAutoresizingMaskIntoConstraints = false
    tray.backgroundColor = keyBgColor()
    tray.layer.cornerRadius = trayRadius
    tray.layer.masksToBounds = true
    tray.isLayoutMarginsRelativeArrangement = true
    tray.layoutMargins = UIEdgeInsets(top: trayPad, left: trayPad, bottom: trayPad, right: trayPad)

    let chipCount = items.count
    let width: CGFloat = CGFloat(chipCount) * chipW + CGFloat(chipCount - 1) * gap + trayPad * 2

    for text in items {
      let chip = UIButton(type: .system)
      chip.setTitle(text, for: .normal)
      chip.setTitleColor(keyTextColor(), for: .normal)
      chip.titleLabel?.font = .systemFont(ofSize: chipFont, weight: .regular)
      chip.backgroundColor = .clear
      chip.layer.cornerRadius = chipRadius
      chip.isUserInteractionEnabled = false
      tray.addArrangedSubview(chip)
    }

    container.addSubview(tray)
    let anchorFrame = anchor.convert(anchor.bounds, to: container)
    let desiredX = anchorFrame.midX - width / 2
    let clampedX = max(4, min(container.bounds.width - width - 4, desiredX))
    let desiredY = anchorFrame.minY + offsetY
    let clampedY = max(4, desiredY)
    NSLayoutConstraint.activate([
      tray.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: clampedX),
      tray.topAnchor.constraint(equalTo: container.topAnchor, constant: clampedY),
      tray.widthAnchor.constraint(equalToConstant: width),
      tray.heightAnchor.constraint(equalToConstant: trayHeight),
    ])
    activeAccentTray = tray
  }

  private func pickAccentAndDismiss(gestureRecognizer gr: UILongPressGestureRecognizer) {
    defer { dismissAccentTray() }
    guard let tray = activeAccentTray else { return }
    let loc = gr.location(in: tray)
    // Find the chip whose frame contains the release point.
    guard let chip = tray.subviews.first(where: { $0.frame.contains(loc) }) as? UIButton,
          let ch = chip.title(for: .normal), !ch.isEmpty else {
      // Slid off the tray — no insert (matches Apple).
      return
    }
    host?.hostTextDocumentProxy.insertText(ch)
    // Same double-tap-caps chain reset as the plain insert path.
    lastShiftTapTime = 0
    if state.shift && !state.capsLock {
      state.shift = false
      stateChanged()
    }
    updateAutoCap()
  }

  private func dismissAccentTray() {
    activeAccentTray?.removeFromSuperview()
    activeAccentTray = nil
  }

  /// Generic icon-bearing key. `props.icon` accepts any of:
  ///   - "sf:name"                     (SF Symbol shorthand)
  ///   - "asset:name"                  (bundled UIImage)
  ///   - "https://…" (or "http://…")   (remote — auto-cached to disk)
  ///   - { sf: "…" } / { asset: "…" } / { url: "…" } / { emoji: "…" }
  ///   - A bare SF Symbol name (backwards compat with older backend trees)
  ///
  /// This is the "end the rebuild cycle" hook — every icon-changing keyboard
  /// tweak is a backend push instead of a Swift release. `on.onPress` carries
  /// the KBActionSpec that fires when tapped (startDictation, insertText,
  /// switchLayout, etc.) so the same node covers mic-like, refine-like, and
  /// arbitrary future buttons.
  private func buildIconKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    let spec = node.props?["icon"]
    // Emoji-as-title path: renders as text so multi-color glyphs display right.
    if let emoji = iconEmoji(spec) {
      btn.setTitle(emoji, for: .normal)
      btn.titleLabel?.font = .systemFont(ofSize: 22)
    } else {
      // Weak-ref the button so the remote-image callback can update it without
      // retaining it beyond the tree lifetime. If a URL fetch completes after
      // the button was already replaced by a re-render, this just no-ops.
      let img = resolveIcon(spec) { [weak btn, weak self] in
        guard let btn = btn else { return }
        btn.setImage(self?.resolveIcon(spec) ?? nil, for: .normal)
      }
      if let img = img {
        btn.setImage(img, for: .normal)
      } else if case .string(let raw) = spec ?? .null,
                !raw.hasPrefix("sf:"), !raw.hasPrefix("asset:"),
                !raw.hasPrefix("http") {
        // Bare "mic.fill"-style names — treat as SF Symbol for compat.
        btn.setImage(UIImage(systemName: raw), for: .normal)
      } else if spec == nil {
        btn.setImage(UIImage(systemName: "questionmark"), for: .normal)
      }
      // Icon tint: prefer node.style.fg override so backend can force a
      // specific icon color (mic on orange bg needs black icon, etc.), fall
      // back to theme's keyText for the general case.
      if let hex = node.style?["fg"]?.asString {
        btn.tintColor = UIColor(tulmiHex: hex)
      } else {
        btn.tintColor = keyTextColor()
      }
      // Optional per-side icon inset so backend can control padding without
      // shipping different assets. Reads props.iconInset (uniform) or
      // props.iconInsetTop/… (per side).
      let uni = node.props?["iconInset"]?.asCGFloat
      let top = node.props?["iconInsetTop"]?.asCGFloat ?? uni ?? 0
      let bot = node.props?["iconInsetBottom"]?.asCGFloat ?? uni ?? 0
      let lef = node.props?["iconInsetLeft"]?.asCGFloat ?? uni ?? 0
      let rig = node.props?["iconInsetRight"]?.asCGFloat ?? uni ?? 0
      if top != 0 || bot != 0 || lef != 0 || rig != 0 {
        btn.imageEdgeInsets = UIEdgeInsets(top: top, left: lef, bottom: bot, right: rig)
      }
    }
    bindTap(btn, node: node, defaultAction: nil)
    return btn
  }

  /// Big space bar. Custom label from `labels.space` falls back to "space".
  /// Behaviors baked in:
  ///  - Single tap → inserts " ". Double-tap within 500ms → replaces the
  ///    trailing space with ". " (Apple's "quick period" pattern).
  ///  - Long-press (~300ms) → trackpad-cursor mode. Finger drags become
  ///    horizontal cursor moves via adjustTextPosition(byCharacterOffset:).
  ///    Two-finger drag reserved for a future selection extension.
  ///  - Sound + haptic fire on the touch-down when Full Access is granted
  ///    (shared with makeKeyButton — this override just handles the special
  ///    tap semantics).
  private func buildSpaceKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    // Native iOS shows "space" if only Tulmi is enabled, but the language code
    // (e.g. "EN") if the user has multiple keyboards installed. Read via
    // state.* so this stays consistent with backend bind: { text: "..." } and
    // the two paths never drift out of sync.
    let label: String
    if state.hasMultipleKeyboards, !state.primaryLanguage.isEmpty {
      label = state.primaryLanguage
    } else {
      label = host?.hostLabel("space", "space") ?? "space"
    }
    btn.setTitle(label, for: .normal)
    btn.titleLabel?.font = .systemFont(ofSize: 15)
    // Single-tap insertion is deferred to touchUpInside so slide-off cancels
    // cleanly (Apple's slide-off pattern) — see bindTap.
    let action = UIAction { [weak self] _ in self?.handleSpaceTap() }
    btn.addAction(action, for: .touchUpInside)

    // Backend flags:
    //   kb.trackpad.enabled       (default true) — disable to lose the feature entirely
    //   kb.trackpad.longPressMs   (default 300) — hold-to-activate threshold
    // (sensitivity / pt-per-char is exposed on the .changed handler below.)
    if flagBool("kb.trackpad.enabled", true) {
      let lp = UILongPressGestureRecognizer(
        target: WeakGRProxy(target: self, selector: #selector(spaceLongPress(_:))),
        action: #selector(WeakGRProxy.handle(_:)))
      lp.minimumPressDuration = flagDouble("kb.trackpad.longPressMs", 300) / 1000.0
      lp.allowableMovement = 1000
      btn.addGestureRecognizer(lp)
    }
    return btn
  }

  /// Fires when the user taps space. Handles the double-space-→-". " pattern.
  private func handleSpaceTap() {
    let now = Date().timeIntervalSince1970
    if state.trackpadActive {
      // Trackpad was ending — swallow this tap; the touchUp inside long-press
      // already released the cursor.
      state.trackpadActive = false
      stateChanged()
      return
    }
    let proxy = host?.hostTextDocumentProxy
    // Backend flag: kb.smartPeriod.windowMs (default 500) — max gap between two
    // space taps for the "double-space → period-space" replacement to fire.
    let recent = now - _lastSpaceTapTime < (flagDouble("kb.smartPeriod.windowMs", 500) / 1000.0)
    let smartPeriodOn: Bool = {
      if let f = config.flags?["kb.smartPeriod"]?.asBool { return f }
      return true
    }()
    if recent && smartPeriodOn,
       let ctx = proxy?.documentContextBeforeInput,
       ctx.hasSuffix(" "),
       let prevChar = ctx.dropLast().last,
       !prevChar.isPunctuation, prevChar != "\n" {
      // Replace the trailing " " with ". ".
      proxy?.deleteBackward()
      proxy?.insertText(". ")
      _lastSpaceTapTime = 0
    } else {
      proxy?.insertText(" ")
      _lastSpaceTapTime = now
    }
    updateAutoCap()
  }

  /// Long-press on the space bar → trackpad-cursor mode. Once .began fires,
  /// we track the finger and issue adjustTextPosition calls in proportion to
  /// horizontal movement. Ends when the finger lifts.
  @objc private func spaceLongPress(_ gr: UILongPressGestureRecognizer) {
    guard let view = gr.view else { return }
    switch gr.state {
    case .began:
      state.trackpadActive = true
      _trackpadAnchor = gr.location(in: view).x
      _trackpadOffset = 0
      // Subtle haptic to signal mode entry.
      if let host = host, host.hostHasFullAccess {
        let g = UIImpactFeedbackGenerator(style: .light)
        g.prepare(); g.impactOccurred()
      }
      stateChanged()
    case .changed:
      let cur = gr.location(in: view).x
      // 7pt per character — matches Apple's feel. Sub-character deltas
      // accumulate in _trackpadOffset so slow drags still move.
      // Backend flag: kb.trackpad.ptPerChar (default 7) — pt of finger drag per
      // one-character cursor step. Higher = less sensitive, easier fine-grained control.
      let raw = Double(cur - _trackpadAnchor) / max(1.0, flagDouble("kb.trackpad.ptPerChar", 7))
      let steps = Int(raw)
      if steps != _trackpadOffset {
        let delta = steps - _trackpadOffset
        host?.hostTextDocumentProxy.adjustTextPosition(byCharacterOffset: delta)
        _trackpadOffset = steps
      }
    case .ended, .cancelled, .failed:
      state.trackpadActive = false
      _lastSpaceTapTime = 0  // don't count the release as a tap
      stateChanged()
    default:
      break
    }
  }

  /// Shift toggle — modern behavior with directional arrows + hold-to-lock:
  ///
  ///   Visual:
  ///     - state.shift = false     → down arrow (lowercase mode)
  ///     - state.shift = true      → up arrow (uppercase mode)
  ///     - state.capsLock = false  → outlined arrow, key-text color
  ///     - state.capsLock = true   → filled arrow, brand orange (locked)
  ///
  ///   Interaction (matches the stock iOS keyboard's caps lock):
  ///     - Tap (unlocked)  → toggle uppercase/lowercase (one-shot arm/disarm)
  ///     - Hold (unlocked) → CAPS LOCK: persistent uppercase (filled orange up)
  ///     - Tap or Hold (locked) → unlock back to lowercase
  ///
  ///   Notes:
  ///     - Caps lock always means uppercase-locked (shift=true, capsLock=true),
  ///       so the invariant capsLock ⇒ shift=true holds. There is no
  ///       locked-lowercase state — that only ever looked like "nothing
  ///       happened" when the user expected caps.
  ///     - Long-press threshold is 0.35s — long enough to distinguish from
  ///       a tap, short enough to feel snappy.
  private func buildShiftKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    applyShiftKeyVisual(btn)
    weakShiftButton = btn  // fast-shift path needs to reach the icon later
    let handler = UIAction { [weak self] _ in self?.handleShiftTap() }
    btn.addAction(handler, for: .touchUpInside)
    // Long-press → lock (or unlock+flip if already locked).
    let lp = UILongPressGestureRecognizer(
      target: WeakGRProxy(target: self, selector: #selector(handleShiftLongPress(_:))),
      action: #selector(WeakGRProxy.handle(_:)))
    // Backend flag: kb.shift.longPressMs (default 350) — hold threshold to lock
    lp.minimumPressDuration = flagDouble("kb.shift.longPressMs", 350) / 1000.0
    // MUST cancel the button's touch (default true) so the finger-up that ends
    // the hold does NOT also fire touchUpInside → handleShiftTap(). Without this
    // the hold locked caps, then the trailing tap saw capsLock == true and
    // immediately unlocked+flipped it — so hold-to-lock appeared to do nothing.
    // (This mirrors the letter accent-tray long-press, which relies on the same
    // default to suppress its insert-on-release.)
    lp.cancelsTouchesInView = true
    btn.addGestureRecognizer(lp)
    return btn
  }

  /// Set the ShiftKey's image + tint based on current state.
  /// Backend flags:
  ///   kb.shift.iconLowerOutlined  (default "arrowtriangle.down")
  ///   kb.shift.iconUpperOutlined  (default "arrowtriangle.up")
  ///   kb.shift.iconLowerLocked    (default "arrowtriangle.down.fill")
  ///   kb.shift.iconUpperLocked    (default "arrowtriangle.up.fill")
  ///   kb.shift.iconSize           (default 16)      — SF Symbol point size
  ///   kb.shift.iconWeight         (default "semibold")
  ///   kb.shift.lockedColor        (default "#E8A23C") — arrow tint when locked
  private func applyShiftKeyVisual(_ btn: UIButton) {
    let icon: String = {
      if state.capsLock {
        return state.shift
          ? flagString("kb.shift.iconUpperLocked", "arrowtriangle.up.fill")
          : flagString("kb.shift.iconLowerLocked", "arrowtriangle.down.fill")
      } else {
        return state.shift
          ? flagString("kb.shift.iconUpperOutlined", "arrowtriangle.up")
          : flagString("kb.shift.iconLowerOutlined", "arrowtriangle.down")
      }
    }()
    let size = flagCGFloat("kb.shift.iconSize", 16)
    let weight = sfWeight(flagString("kb.shift.iconWeight", "semibold"))
    let cfg = UIImage.SymbolConfiguration(pointSize: size, weight: weight)
    btn.setImage(UIImage(systemName: icon, withConfiguration: cfg), for: .normal)
    btn.setTitle(nil, for: .normal)
    btn.tintColor = state.capsLock
      ? flagColor("kb.shift.lockedColor", "#E8A23C")
      : keyTextColor()
    btn.contentHorizontalAlignment = .center
    btn.contentVerticalAlignment = .center
  }

  @objc private func handleShiftLongPress(_ gr: UILongPressGestureRecognizer) {
    guard gr.state == .began else { return }
    if state.capsLock {
      // Locked → unlock back to lowercase.
      state.capsLock = false
      state.shift = false
    } else {
      // Unlocked → CAPS LOCK: force persistent uppercase (stock-keyboard caps).
      state.capsLock = true
      state.shift = true
    }
    lastShiftTapTime = 0
    stateChanged()
    fireKeyHaptic()
  }

  private func handleShiftTap() {
    // Locked (caps lock) → tap unlocks back to lowercase.
    if state.capsLock {
      state.capsLock = false
      state.shift = false
      lastShiftTapTime = 0
      stateChanged()
      return
    }
    // Double-tap shift → CAPS LOCK, matching the system keyboard. A second tap
    // within kb.shift.doubleTapMs of the last engages a persistent uppercase
    // lock. (Hold-to-lock is kept too, via handleShiftLongPress, as a bonus.)
    let now = Date().timeIntervalSince1970
    let window = flagDouble("kb.shift.doubleTapMs", 300) / 1000.0
    if lastShiftTapTime > 0 && (now - lastShiftTapTime) <= window {
      state.capsLock = true
      state.shift = true
      lastShiftTapTime = 0
      stateChanged()
      fireKeyHaptic()
      return
    }
    // Single tap → one-shot uppercase for the next letter.
    state.shift.toggle()
    lastShiftTapTime = now
    stateChanged()
  }

  /// Return key — inserts newline. Adapts label + tint to the current field's
  /// UIReturnKeyType so Go / Send / Search / Done render correctly with the
  /// system-blue accent (Apple's convention for action returns).
  private func buildReturnKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    let rt = host?.hostReturnKeyType() ?? .default
    btn.setTitle(returnKeyLabel(for: rt), for: .normal)
    if returnKeyIsAction(rt) {
      // Backend flags:
      //   kb.returnKey.actionBg   (default "#007AFF") — accent for Go/Send/Search/Done
      //   kb.returnKey.actionFg   (default "#FFFFFF")
      let accent = flagColor("kb.returnKey.actionBg", "#007AFF")
      btn.backgroundColor = accent
      btn.setTitleColor(flagColor("kb.returnKey.actionFg", "#FFFFFF"), for: .normal)
      objc_setAssociatedObject(btn, &Self.keyBaseColorKey, accent, .OBJC_ASSOCIATION_RETAIN)
    }
    bindTap(btn, node: node, defaultAction: .returnKey)
    return btn
  }

  /// Localized label for a UIReturnKeyType. Values pulled from Apple's own
  /// UIKit table (matched empirically). Return "return" for default.
  private func returnKeyLabel(for type: UIReturnKeyType) -> String {
    switch type {
    case .go:              return host?.hostLabel("return.go", "Go") ?? "Go"
    case .join:            return host?.hostLabel("return.join", "Join") ?? "Join"
    case .next:            return host?.hostLabel("return.next", "Next") ?? "Next"
    case .route:           return host?.hostLabel("return.route", "Route") ?? "Route"
    case .search:          return host?.hostLabel("return.search", "Search") ?? "Search"
    case .send:            return host?.hostLabel("return.send", "Send") ?? "Send"
    case .yahoo:           return host?.hostLabel("return.yahoo", "Yahoo") ?? "Yahoo"
    case .google:          return host?.hostLabel("return.google", "Google") ?? "Google"
    case .done:            return host?.hostLabel("return.done", "Done") ?? "Done"
    case .emergencyCall:   return host?.hostLabel("return.emergency", "Emergency") ?? "Emergency"
    case .continue:        return host?.hostLabel("return.continue", "Continue") ?? "Continue"
    case .default:         return host?.hostLabel("return", "return") ?? "return"
    @unknown default:      return host?.hostLabel("return", "return") ?? "return"
    }
  }

  /// True for the return types Apple accents in system-blue (action returns).
  private func returnKeyIsAction(_ type: UIReturnKeyType) -> Bool {
    switch type {
    case .default, .next: return false
    default: return true
    }
  }

  /// Backspace — tap deletes one; long-press repeats (200ms initial then 40ms).
  private func buildBackspaceKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    btn.setImage(UIImage(systemName: "delete.left"), for: .normal)
    btn.tintColor = keyTextColor()
    btn.addTarget(self, action: #selector(deleteDown), for: .touchDown)
    btn.addTarget(self, action: #selector(deleteUp),
                  for: [.touchUpInside, .touchUpOutside, .touchCancel])
    return btn
  }
  @objc private func deleteDown() {
    // First delete fires immediately on touch-down (Apple's pattern).
    host?.hostTextDocumentProxy.deleteBackward()
    deleteRepeatCount = 1
    deleteTimer?.invalidate()
    // 500ms initial delay before repeat begins, then 90ms per char for the
    // first 20 chars, then accelerate to whole-word deletion. Matches Apple's
    // measured timings (see research report).
    //
    // Backend flag: kb.delete.initialDelayMs (default 500) — how long the user
    // must hold before the auto-repeat kicks in.
    // CRITICAL: scheduledTimer(withTimeInterval:...) adds to .default runloop
    // mode. While a finger is on the screen iOS switches to .tracking mode
    // and .default timers pause. Add explicitly to .common instead.
    let initialDelay = flagDouble("kb.delete.initialDelayMs", 500) / 1000.0
    let initial = Timer(timeInterval: initialDelay, repeats: false) { [weak self] _ in
      self?.startDeleteRepeat()
    }
    RunLoop.main.add(initial, forMode: .common)
    deleteTimer = initial
    // Selection haptic on first press so touch-down feels alive even when the
    // repeat hasn't kicked in yet.
    fireKeyHaptic()
  }

  private func startDeleteRepeat() {
    // Backend flags:
    //   kb.delete.repeatIntervalMs  (default 90)   — per-char delete cadence
    //   kb.delete.wordAfterChars    (default 20)   — count before word-boundary mode
    // Same .common-mode requirement — see deleteDown for why.
    let intervalMs = flagDouble("kb.delete.repeatIntervalMs", 90) / 1000.0
    let wordThreshold = Int(flagDouble("kb.delete.wordAfterChars", 20))
    let repeatTimer = Timer(timeInterval: intervalMs, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      self.deleteRepeatCount += 1
      if self.deleteRepeatCount > wordThreshold {
        self.deleteWordBoundary()
      } else {
        self.host?.hostTextDocumentProxy.deleteBackward()
      }
    }
    RunLoop.main.add(repeatTimer, forMode: .common)
    deleteTimer = repeatTimer
  }

  private func deleteWordBoundary() {
    guard let p = host?.hostTextDocumentProxy else { return }
    var deleted = 0
    while deleted < 64 {
      let ctx = p.documentContextBeforeInput ?? ""
      guard let last = ctx.last else { break }
      p.deleteBackward()
      deleted += 1
      if last.isWhitespace || last.isNewline { break }
    }
  }

  @objc private func deleteUp() {
    deleteTimer?.invalidate()
    deleteTimer = nil
    deleteRepeatCount = 0
    updateAutoCap()
  }

  /// Globe key — advances to next input mode (system behavior). Long-press
  /// falls through to a `showLanguageMenu` action if `on.onLongPress` is set.
  private func buildGlobeKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    btn.setImage(UIImage(systemName: "globe"), for: .normal)
    btn.tintColor = keyTextColor()
    let action = UIAction { [weak self] _ in self?.host?.hostAdvanceInputMode() }
    btn.addAction(action, for: .touchUpInside)
    if let long = node.on?["onLongPress"] {
      let lp = UILongPressGestureRecognizer(
        target: WeakGRProxy(target: self, selector: #selector(longPressFired(_:))),
        action: #selector(WeakGRProxy.handle(_:)))
      lp.name = "kb.longPress.action"
      btn.addGestureRecognizer(lp)
      objc_setAssociatedObject(lp, &Self.longPressActionKey, long, .OBJC_ASSOCIATION_RETAIN)
    }
    return btn
  }
  private static var longPressActionKey: UInt8 = 0
  @objc private func longPressFired(_ gr: UILongPressGestureRecognizer) {
    guard gr.state == .began else { return }
    if let ref = objc_getAssociatedObject(gr, &Self.longPressActionKey) as? KBActionRef {
      run(ref)
    }
  }

  /// Mic key — toggles startDictation / stopDictation based on state.dictating.
  /// Icon tint respects node.style.fg (backend can override the theme's white
  /// keyText — the tools-row mic uses black-on-orange). Stop-dictation now
  /// auto-fires runRefine so the captured message moves straight into the
  /// refinement pipeline without a second button press.
  ///
  /// The default action wiring here still exists so old backend trees (that
  /// don't specify on.onPress) keep working. New trees can override with
  /// on.onPress: { kind: "condition", ... } for custom flows — see
  /// makeToolsRow() in the backend catalog.
  private func buildMicKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    // Register for later access by the dot-stream visualizer during recording.
    // There's only ever one MicKey rendered at a time (dark and light variants
    // are visibleIf-gated), so a single weak ref is safe.
    currentMicButton = btn
    // Icon tint: prefer explicit style.fg override, else keyTextColor().
    let tint: UIColor = {
      if let hex = node.style?["fg"]?.asString { return UIColor(tulmiHex: hex) }
      return keyTextColor()
    }()
    // Mic appearance:
    //   • RECORDING → the brand structure gives way to a tiny physics sim: a
    //     handful of dots wandering inside the circle, bouncing off the wall
    //     and each other (MicParticleView). Backend can disable it via
    //     kb.mic.particles=false to fall back to the animated media.
    //   • IDLE      → the CLEAN brand mark (bundled TailzuMark, else SF mic) on
    //     the amber circle — "the structure".
    let particlesOn = flagBool("kb.mic.particles", true)
    if (state.dictating || micReassembling), particlesOn {
      // The structure bursts apart into the dots (recording), or the dots are
      // springing back into the structure (micReassembling, after stop). Either
      // way we mount the SAME persistent sim so the motion is continuous across
      // the remount — never a re-seed mid-flight.
      btn.setImage(nil, for: .normal)
      let particles: MicParticleView
      if let existing = currentMicParticles {
        existing.removeFromSuperview()          // detach from the discarded btn
        particles = existing                    // reuse → dots + physics continuity
      } else {
        // More, tinier dots → a dense swarm that constantly collides with the
        // wall and each other, instead of a few big blobs. Backend-tunable.
        let count = Int(flagCGFloat("kb.mic.particles.count", 60))
        let dotR = flagCGFloat("kb.mic.particles.radius", 0.9)
        let mark = UIImage(named: "TailzuMark", in: Bundle.main, compatibleWith: nil)
        particles = MicParticleView(count: count, dotRadius: dotR, color: tint, sourceImage: mark)
        currentMicParticles = particles
      }
      particles.translatesAutoresizingMaskIntoConstraints = false
      btn.addSubview(particles)
      let inset = flagCGFloat("kb.mic.particles.inset", 6)
      NSLayoutConstraint.activate([
        particles.leadingAnchor.constraint(equalTo: btn.leadingAnchor, constant: inset),
        particles.trailingAnchor.constraint(equalTo: btn.trailingAnchor, constant: -inset),
        particles.topAnchor.constraint(equalTo: btn.topAnchor, constant: inset),
        particles.bottomAnchor.constraint(equalTo: btn.bottomAnchor, constant: -inset),
      ])
    } else if state.dictating,
              let spec = flagIcon("kb.mic.idleIcon"),
              let img = resolveIcon(spec, onLoad: { [weak self] in self?.stateChanged() }) {
      // Fallback recording visual (particles disabled): the animated media.
      btn.setImage(img, for: .normal)
      btn.imageEdgeInsets = .zero
      btn.imageView?.contentMode = .scaleAspectFill
      btn.imageView?.startAnimating()
    } else if let mark = UIImage(named: "TailzuMark", in: Bundle.main, compatibleWith: nil) {
      // Idle brand mark, inset so it reads as an icon centered on the circle.
      btn.setImage(mark.withRenderingMode(.alwaysTemplate), for: .normal)
      btn.imageView?.stopAnimating()
      btn.imageView?.contentMode = .scaleAspectFit
      let inset = flagCGFloat("kb.mic.idleIconInset", 8)
      btn.imageEdgeInsets = UIEdgeInsets(top: inset, left: inset, bottom: inset, right: inset)
    } else {
      btn.setImage(UIImage(systemName: "mic.fill"), for: .normal)
    }
    btn.tintColor = tint
    // If the backend provided an explicit on.onPress, use that (backend can
    // wire condition + sequence to do "stop then refine" itself). Otherwise
    // fall back to the built-in toggle — WITH auto-refine on stop so the
    // captured text always moves forward regardless of tree shape.
    if let ref = node.on?["onPress"] {
      let action = UIAction { [weak self] _ in self?.run(ref) }
      btn.addAction(action, for: .touchUpInside)
    } else if !["local", "stream", "handoff"].contains(flagString("kb.mic.mode", "flow").lowercased()) {
      // FLOW mode — and any ABSENT/UNKNOWN mode, since iOS blocks in-extension
      // recording so we must never default to it — has its OWN state machine in
      // the host (arm → dictate → stop, driven by the background-audio session).
      // Only an explicit "local"/"stream"/"handoff" takes the toggle branch below.
      // The renderer must NOT toggle
      // state.dictating here or auto-run refine — doing both is what desynced
      // the mic: the first tap (which only opens the app to arm) still fired the
      // recording particles and left `dictating` stuck true, so the next tap hit
      // the "stop + refine" branch and pushed a bad refine onto the typepad.
      // Defer entirely to the host: it calls reflectDictating(true/false) ONLY
      // when audio is actually being captured, so the particles + icon track the
      // real recording state, and it owns whether/when to refine.
      let action = UIAction { [weak self] _ in self?.host?.hostStartDictation() }
      btn.addAction(action, for: .touchUpInside)
    } else {
      let action = UIAction { [weak self] _ in
        guard let self = self else { return }
        if self.state.dictating {
          // stopDictation → runRefine, so the message auto-flows into refine.
          self.run(.inline(.sequence(actions: [
            .inline(.stopDictation),
            .inline(.runRefine),
          ])))
        } else {
          self.run(.inline(.startDictation))
        }
      }
      btn.addAction(action, for: .touchUpInside)
    }
    return btn
  }

  /// Refine key — dispatches runRefine.
  private func buildRefineKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    btn.setImage(UIImage(systemName: "sparkles"), for: .normal)
    btn.tintColor = keyTextColor()
    let action = UIAction { [weak self] _ in self?.run(.inline(.runRefine)) }
    btn.addAction(action, for: .touchUpInside)
    return btn
  }

  /// Suggestion bar — horizontal scroll of chip buttons from state.suggestions.
  /// Empty until backend fills it; view is still laid out (fixed height).
  private func buildSuggestionBar(node: KBNode) -> UIView {
    // Backend flags:
    //   kb.suggestion.gap        (default 8)   — spacing between chips
    //   kb.suggestion.edgeInset  (default 8)   — left/right padding of the scroll region
    //   kb.suggestion.chipRadius (default 12)
    //   kb.suggestion.chipPadV   (default 4)   — vertical padding inside chip
    //   kb.suggestion.chipPadH   (default 12)  — horizontal padding inside chip
    //   kb.suggestion.height     (default 36)
    let gap = flagCGFloat("kb.suggestion.gap", 8)
    let edge = flagCGFloat("kb.suggestion.edgeInset", 8)
    let chipRadius = flagCGFloat("kb.suggestion.chipRadius", 12)
    let chipPadV = flagCGFloat("kb.suggestion.chipPadV", 4)
    let chipPadH = flagCGFloat("kb.suggestion.chipPadH", 12)
    let barHeight = flagCGFloat("kb.suggestion.height", 36)

    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    let row = UIStackView()
    row.axis = .horizontal
    row.spacing = gap
    row.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(row)
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: scroll.leadingAnchor, constant: edge),
      row.trailingAnchor.constraint(equalTo: scroll.trailingAnchor, constant: -edge),
      row.topAnchor.constraint(equalTo: scroll.topAnchor),
      row.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
      row.heightAnchor.constraint(equalTo: scroll.heightAnchor),
    ])
    for s in state.suggestions {
      let chip = UIButton(type: .system)
      chip.setTitle(s, for: .normal)
      chip.setTitleColor(keyTextColor(), for: .normal)
      chip.backgroundColor = keyBgColor()
      chip.layer.cornerRadius = chipRadius
      chip.contentEdgeInsets = UIEdgeInsets(top: chipPadV, left: chipPadH, bottom: chipPadV, right: chipPadH)
      let action = UIAction { [weak self] _ in
        self?.host?.hostTextDocumentProxy.insertText(s + " ")
      }
      chip.addAction(action, for: .touchUpInside)
      row.addArrangedSubview(chip)
    }
    scroll.heightAnchor.constraint(equalToConstant: barHeight).isActive = true
    return scroll
  }

  /// Waveform bars — driven by a 30 FPS Timer modulating bar heights from
  /// state.micLevel with a random baseline (matches the RN counterpart).
  private func buildWaveform(node: KBNode) -> UIView {
    // Backend flags:
    //   kb.waveform.barCount        (default 24)
    //   kb.waveform.color           (default "#999999")
    //   kb.waveform.radius          (default 1.5)
    //   kb.waveform.spacing         (default 3)
    //   kb.waveform.height          (default 24)
    //   kb.waveform.levelMultiplier (default 0.6)
    //   kb.waveform.baselineMin     (default 0.2)
    //   kb.waveform.baselineMax     (default 0.6)
    //   kb.waveform.fps             (default 30) — see below
    let cfg = WaveformView.Config(
      barCount: Int(flagDouble("kb.waveform.barCount", 24)),
      barColor: flagColor("kb.waveform.color", "#999999"),
      barRadius: flagCGFloat("kb.waveform.radius", 1.5),
      barSpacing: flagCGFloat("kb.waveform.spacing", 3),
      height: flagCGFloat("kb.waveform.height", 24),
      levelMultiplier: flagCGFloat("kb.waveform.levelMultiplier", 0.6),
      baselineMin: flagCGFloat("kb.waveform.baselineMin", 0.2),
      baselineMax: flagCGFloat("kb.waveform.baselineMax", 0.6),
    )
    let w = WaveformView(config: cfg)
    w.tintColor = keyTextColor()
    w.setLevel(state.micLevel)
    if waveformTimer == nil {
      // Backend flag: kb.waveform.fps (default 30)
      let fps = flagDouble("kb.waveform.fps", 30)
      let t = Timer(timeInterval: 1.0 / max(1.0, fps), repeats: true) { [weak self] _ in
        self?.waveformView?.setLevel(self?.state.micLevel ?? 0)
      }
      RunLoop.main.add(t, forMode: .common)
      waveformTimer = t
    }
    waveformView = w
    return w
  }

  /// Bound to state.status — updated whenever the host reflects setStatus().
  private func buildStatusLabel(node: KBNode) -> UIView {
    let l = UILabel()
    l.text = state.status
    l.textAlignment = .center
    l.font = .systemFont(ofSize: 12)
    l.textColor = keyTextColor()
    l.isHidden = state.status.isEmpty
    return l
  }

  /// 1pt hairline divider.
  private func buildDivider(node: KBNode) -> UIView {
    let v = UIView()
    v.backgroundColor = UIColor(white: 1, alpha: 0.08)
    v.heightAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale).isActive = true
    return v
  }

  /// Blur backdrop wrapping the children — UIVisualEffectView with the mapped
  /// UIBlurEffect.Style from the node's effect.
  private func buildBlurBackdrop(node: KBNode) -> UIView {
    let style = blurStyle(from: node.effect ?? .blur(style: "systemThinMaterial"))
    let effectView = UIVisualEffectView(effect: UIBlurEffect(style: style))
    // Children mount inside the effect view's contentView so they render above
    // the blur, not underneath it.
    let stack = UIStackView()
    stack.axis = .vertical
    stack.alignment = .fill
    stack.spacing = CGFloat(node.style?["spacing"]?.asDouble ?? 0)
    stack.translatesAutoresizingMaskIntoConstraints = false
    for c in node.children ?? [] {
      stack.addArrangedSubview(render(node: c))
    }
    effectView.contentView.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: effectView.contentView.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: effectView.contentView.trailingAnchor),
      stack.topAnchor.constraint(equalTo: effectView.contentView.topAnchor),
      stack.bottomAnchor.constraint(equalTo: effectView.contentView.bottomAnchor),
    ])
    return effectView
  }

  /// Placeholder for unknown component types — a small red view labeled "?"
  /// so schema mismatches show up on screen instead of silently disappearing.
  private func buildUnknown(type: String) -> UIView {
    NSLog("unknown kb component: %@", type)
    let v = UIView()
    v.backgroundColor = .red
    let l = UILabel()
    l.text = "?"
    l.textColor = .white
    l.textAlignment = .center
    l.font = .boldSystemFont(ofSize: 14)
    l.translatesAutoresizingMaskIntoConstraints = false
    v.addSubview(l)
    NSLayoutConstraint.activate([
      l.leadingAnchor.constraint(equalTo: v.leadingAnchor),
      l.trailingAnchor.constraint(equalTo: v.trailingAnchor),
      l.topAnchor.constraint(equalTo: v.topAnchor),
      l.bottomAnchor.constraint(equalTo: v.bottomAnchor),
    ])
    v.widthAnchor.constraint(greaterThanOrEqualToConstant: 30).isActive = true
    v.heightAnchor.constraint(greaterThanOrEqualToConstant: 20).isActive = true
    return v
  }

  // MARK: - Generic node builders (backend can render arbitrary UI)

  /// Free-form text label. Backend controls all of: text (literal via
  /// props.text OR live via bind.text against state.*), font size, weight,
  /// color, alignment, numberOfLines. Kept intentionally generic so a single
  /// node type covers headers, status lines, hints, etc.
  private func buildTextLabel(node: KBNode) -> UIView {
    let l = UILabel()
    l.numberOfLines = Int(node.props?["numberOfLines"]?.asDouble ?? 1)
    let literal = node.props?["text"]?.asString
    if let bound = node.bind?["text"], let val = stateValue(for: bound) {
      l.text = val
    } else {
      l.text = literal
    }
    if let size = node.style?["fontSize"]?.asCGFloat {
      let weight = fontWeight(from: node.style?["fontWeight"]?.asString)
      l.font = .systemFont(ofSize: size, weight: weight)
    }
    if let fg = node.style?["fg"]?.asString { l.textColor = UIColor(tulmiHex: fg) }
    switch node.style?["align"]?.asString {
    case "center": l.textAlignment = .center
    case "right":  l.textAlignment = .right
    default:       l.textAlignment = .left
    }
    return l
  }

  /// Static image node. `props.source` accepts the same shapes as
  /// IconKey.props.icon: { sf } / { asset } / { url } / { emoji } / string
  /// shorthand. Async fetches auto-refresh via resolveIcon's onLoad callback.
  private func buildImageNode(node: KBNode) -> UIView {
    let iv = UIImageView()
    iv.contentMode = .scaleAspectFit
    let spec = node.props?["source"] ?? node.props?["icon"]
    if let emoji = iconEmoji(spec) {
      // Render emoji as a label — no image needed.
      let l = UILabel()
      l.text = emoji
      l.textAlignment = .center
      l.font = .systemFont(ofSize: node.style?["fontSize"]?.asCGFloat ?? 32)
      return l
    }
    if let img = resolveIcon(spec, onLoad: { [weak iv, weak self] in
      iv?.image = self?.resolveIcon(spec)
    }) {
      iv.image = img
    }
    if let tint = node.style?["fg"]?.asString {
      iv.tintColor = UIColor(tulmiHex: tint)
    }
    return iv
  }

  /// Simple 0–1 progress bar. `bind.value` → state path returning a number.
  /// style controls track/fill color, height, radius.
  private func buildProgressBar(node: KBNode) -> UIView {
    let track = UIView()
    track.backgroundColor = UIColor(tulmiHex: node.style?["trackBg"]?.asString ?? "#FFFFFF1A")
    track.layer.cornerRadius = node.style?["radius"]?.asCGFloat ?? 4
    track.clipsToBounds = true
    let fill = UIView()
    fill.backgroundColor = UIColor(tulmiHex: node.style?["fg"]?.asString ?? "#FFFFFFCC")
    fill.translatesAutoresizingMaskIntoConstraints = false
    track.addSubview(fill)
    let value: CGFloat = {
      if let key = node.bind?["value"] {
        let v = lookup(key.hasPrefix("state.") ? key : "state.\(key)").asDouble ?? 0
        return CGFloat(max(0, min(1, v)))
      }
      return CGFloat(node.props?["value"]?.asDouble ?? 0)
    }()
    NSLayoutConstraint.activate([
      fill.leadingAnchor.constraint(equalTo: track.leadingAnchor),
      fill.topAnchor.constraint(equalTo: track.topAnchor),
      fill.bottomAnchor.constraint(equalTo: track.bottomAnchor),
      fill.widthAnchor.constraint(equalTo: track.widthAnchor, multiplier: max(0.001, value)),
    ])
    return track
  }

  /// UISwitch bound to a state.user.* path via bind.value. Backend can also
  /// wire on.onChange to any action ref if it wants extra work after the flip.
  private func buildToggleNode(node: KBNode) -> UIView {
    let sw = UISwitch()
    let path = node.bind?["value"]
    if let p = path {
      let key = p.hasPrefix("state.") ? p : "state.\(p)"
      sw.isOn = truthy(lookup(key))
    }
    sw.addAction(UIAction { [weak self, weak sw] _ in
      guard let self = self, let sw = sw else { return }
      if let p = path {
        let bare = p.hasPrefix("state.user.") ? String(p.dropFirst("state.user.".count)) : p
        self.writeStatePath(bare, .bool(sw.isOn))
      }
      if let ref = node.on?["onChange"] {
        self.run(ref)
      }
      self.stateChanged()
    }, for: .valueChanged)
    return sw
  }

  /// UIScrollView container. Children lay out inside a UIStackView so the
  /// existing flex / gap / padding style keys still work. `props.horizontal`
  /// swaps axis.
  private func buildScrollView(node: KBNode) -> UIView {
    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    scroll.showsVerticalScrollIndicator = false
    let horizontal = node.props?["horizontal"]?.asBool ?? false
    let stack = UIStackView()
    stack.axis = horizontal ? .horizontal : .vertical
    stack.spacing = CGFloat(node.style?["gap"]?.asDouble ?? node.style?["spacing"]?.asDouble ?? 6)
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
      stack.topAnchor.constraint(equalTo: scroll.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
    ])
    if horizontal {
      stack.heightAnchor.constraint(equalTo: scroll.heightAnchor).isActive = true
    } else {
      stack.widthAnchor.constraint(equalTo: scroll.widthAnchor).isActive = true
    }
    for child in node.children ?? [] {
      stack.addArrangedSubview(render(node: child))
    }
    return scroll
  }

  // MARK: - Style + effect resolvers

  /// Apply the node's `style` bag: sizes, insets, radius, colors, font.
  /// Unknown keys are ignored so extending the schema doesn't crash old builds.
  private func applyStyle(node: KBNode, to view: UIView) {
    guard let style = node.style else { return }
    if let w = style["width"]?.asCGFloat {
      view.widthAnchor.constraint(equalToConstant: w).isActive = true
    }
    if let h = style["height"]?.asCGFloat {
      view.heightAnchor.constraint(equalToConstant: h).isActive = true
    }
    if let radius = style["radius"]?.asCGFloat {
      view.layer.cornerRadius = radius
      view.clipsToBounds = true
    }
    if let bg = style["bg"]?.asString {
      view.backgroundColor = UIColor(tulmiHex: bg)
    }
    // Opacity / border / shadow — all backend-controllable style knobs. Kept
    // ignored when unset so old backend trees don't accidentally change look.
    if let opacity = style["opacity"]?.asDouble {
      view.alpha = CGFloat(opacity)
    }
    if let borderColor = style["borderColor"]?.asString {
      view.layer.borderColor = UIColor(tulmiHex: borderColor).cgColor
    }
    if let borderWidth = style["borderWidth"]?.asCGFloat {
      view.layer.borderWidth = borderWidth
    }
    if case .object(let shadow)? = style["shadow"] {
      view.layer.shadowColor = UIColor(tulmiHex: shadow["color"]?.asString ?? "#000000").cgColor
      view.layer.shadowOpacity = Float(shadow["opacity"]?.asDouble ?? 0.5)
      view.layer.shadowRadius = shadow["radius"]?.asCGFloat ?? 4
      if case .array(let offset)? = shadow["offset"], offset.count == 2 {
        view.layer.shadowOffset = CGSize(
          width: offset[0].asDouble ?? 0,
          height: offset[1].asDouble ?? 2,
        )
      }
      view.clipsToBounds = false  // shadows need overflow
    }
    if let stack = view as? UIStackView {
      // Per-side padding: layoutMargins with individual insets. Uniform
      // `padding` still works as the fallback when specific sides aren't set.
      let pad = style["padding"]?.asCGFloat
      let padTop = style["paddingTop"]?.asCGFloat ?? pad
      let padBottom = style["paddingBottom"]?.asCGFloat ?? pad
      let padLeft = style["paddingLeft"]?.asCGFloat ?? pad
      let padRight = style["paddingRight"]?.asCGFloat ?? pad
      if padTop != nil || padBottom != nil || padLeft != nil || padRight != nil {
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(
          top: padTop ?? 0,
          left: padLeft ?? 0,
          bottom: padBottom ?? 0,
          right: padRight ?? 0,
        )
      }
      // flex on the stack itself no longer forces fillEqually — the parent
      // buildStack now applies proportional widthAnchor multipliers per-child
      // based on their flex ratio. fillEqually would blow that away.
    }
    if let btn = view as? UIButton {
      if let fg = style["fg"]?.asString {
        btn.setTitleColor(UIColor(tulmiHex: fg), for: .normal)
      }
      if let fs = style["fontSize"]?.asCGFloat {
        let weight = fontWeight(from: style["fontWeight"]?.asString)
        btn.titleLabel?.font = .systemFont(ofSize: fs, weight: weight)
      }
    }
    if let lbl = view as? UILabel {
      if let fg = style["fg"]?.asString { lbl.textColor = UIColor(tulmiHex: fg) }
      if let fs = style["fontSize"]?.asCGFloat {
        let weight = fontWeight(from: style["fontWeight"]?.asString)
        lbl.font = .systemFont(ofSize: fs, weight: weight)
      }
    }
    // `flex` on a Spacer / leaf → let it grow inside a stack.
    if let flex = style["flex"]?.asDouble, flex > 0 {
      view.setContentHuggingPriority(.defaultLow, for: .horizontal)
      view.setContentHuggingPriority(.defaultLow, for: .vertical)
    }
  }

  private func fontWeight(from raw: String?) -> UIFont.Weight {
    switch (raw ?? "").lowercased() {
    case "ultralight": return .ultraLight
    case "thin":       return .thin
    case "light":      return .light
    case "regular":    return .regular
    case "medium":     return .medium
    case "semibold":   return .semibold
    case "bold":       return .bold
    case "heavy":      return .heavy
    case "black":      return .black
    default:           return .regular
    }
  }

  /// Apply node.effect to a view. Solid → backgroundColor, gradient →
  /// CAGradientLayer, blur → underlaid effect view. For nodes with children
  /// the effect view sits at subview index 0 so children render above it —
  /// UIStackView still lays out its arrangedSubviews on top.
  private func applyEffectIfChildlessBackdrop(node: KBNode, view: UIView) {
    guard let effect = node.effect else { return }
    switch effect {
    case .solid(let color):
      view.backgroundColor = UIColor(tulmiHex: color)
    case .gradient(let colors, let direction):
      // Wrap in the GradientView subclass (same one used by makeEffectBackdrop)
      // so the CAGradientLayer resizes via layoutSubviews. Raw CALayer
      // autoresizing masks are Mac-only — iOS refuses them.
      let g = GradientView()
      g.gradientColors = colors.map { UIColor(tulmiHex: $0).cgColor }
      g.horizontal = (direction == "horizontal")
      g.translatesAutoresizingMaskIntoConstraints = false
      view.insertSubview(g, at: 0)
      NSLayoutConstraint.activate([
        g.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        g.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        g.topAnchor.constraint(equalTo: view.topAnchor),
        g.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      ])
      view.layer.masksToBounds = true
    case .blur(let style):
      let blur = UIVisualEffectView(effect: UIBlurEffect(style: mapBlur(style)))
      blur.translatesAutoresizingMaskIntoConstraints = false
      view.insertSubview(blur, at: 0)
      NSLayoutConstraint.activate([
        blur.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        blur.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        blur.topAnchor.constraint(equalTo: view.topAnchor),
        blur.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      ])
    }
  }

  private func makeEffectBackdrop(effect: KBEffect) -> UIView {
    switch effect {
    case .solid(let color):
      let v = UIView()
      v.backgroundColor = UIColor(tulmiHex: color)
      return v
    case .blur(let style):
      return UIVisualEffectView(effect: UIBlurEffect(style: mapBlur(style)))
    case .gradient(let colors, let direction):
      let host = GradientView()
      host.gradientColors = colors.map { UIColor(tulmiHex: $0).cgColor }
      host.horizontal = direction == "horizontal"
      return host
    }
  }

  /// Map the schema's KeyboardEffect.blur.style enum to UIBlurEffect.Style.
  private func mapBlur(_ raw: String) -> UIBlurEffect.Style {
    switch raw {
    case "chromeMaterialDark":     return .systemChromeMaterialDark
    case "chromeMaterialLight":    return .systemChromeMaterialLight
    case "systemThinMaterial":     return .systemThinMaterial
    case "systemUltraThinMaterial": return .systemUltraThinMaterial
    case "regular":                return .regular
    default:                       return .systemThinMaterial
    }
  }

  private func blurStyle(from effect: KBEffect) -> UIBlurEffect.Style {
    if case .blur(let s) = effect { return mapBlur(s) }
    return .systemThinMaterial
  }

  // MARK: - Key styling helpers

  /// A generic button matching the hand-built path's default look; overridden
  /// by node-level `style`. Handles:
  ///   - Base fill + shadow + radius from theme
  ///   - Optional per-key blur from theme.keyEffect
  ///   - Press-down visual highlight (Apple's inversion swap) via touch handlers
  ///   - Sound + haptic on touch-down (Full Access gated)
  private func makeKeyButton() -> UIButton {
    // KeyHitButton (via init(frame:), NOT UIButton(type:.system) — that factory
    // doesn't return the subclass) so the expanded touch target below actually
    // applies. Every visual is set explicitly below, so .custom looks identical
    // to the old .system key. The hit slop pushes each key's tappable area into
    // the gaps + absorbs finger drift — the fix for "only a firm, dead-center
    // tap types". Tunable OTA via kb.key.hitSlop.x / .y.
    let b = KeyHitButton(frame: .zero)
    b.hitSlop = UIEdgeInsets(
      // x defaults to HALF the inter-key gap (gap 5 → 2): at slop ≥ gap the two
      // neighbors' expanded targets both cover the whole gap, UIKit's reverse-
      // order hitTest always hands the gap to the RIGHT key, and the row's
      // nearest-key midpoint routing never runs — a systematic rightward
      // mistype bias. Half-gap keeps forgiveness without overlap.
      top: flagCGFloat("kb.key.hitSlop.y", 8), left: flagCGFloat("kb.key.hitSlop.x", 2),
      bottom: flagCGFloat("kb.key.hitSlop.y", 8), right: flagCGFloat("kb.key.hitSlop.x", 2))
    b.setTitleColor(keyTextColor(), for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 18)
    let base = keyBgColor()
    b.backgroundColor = base
    b.layer.cornerRadius = CGFloat(theme?.keyRadius ?? 5)
    if theme?.keyShadow == true {
      // Backend flags:
      //   kb.key.shadow.color   (default "#000000")
      //   kb.key.shadow.offsetY (default 1)
      //   kb.key.shadow.radius  (default 0)
      //   kb.key.shadow.opacity (default 0.4)
      b.layer.shadowColor = flagColor("kb.key.shadow.color", "#000000").cgColor
      b.layer.shadowOffset = CGSize(width: 0, height: flagCGFloat("kb.key.shadow.offsetY", 1))
      b.layer.shadowRadius = flagCGFloat("kb.key.shadow.radius", 0)
      b.layer.shadowOpacity = Float(flagDouble("kb.key.shadow.opacity", 0.4))
    }
    // If the theme carries a keyEffect blur, drop it under the button.
    if case .blur(let s) = theme?.keyEffect ?? .solid(color: "#00000000") {
      let blur = UIVisualEffectView(effect: UIBlurEffect(style: mapBlur(s)))
      blur.translatesAutoresizingMaskIntoConstraints = false
      blur.layer.cornerRadius = b.layer.cornerRadius
      blur.clipsToBounds = true
      b.insertSubview(blur, at: 0)
      NSLayoutConstraint.activate([
        blur.leadingAnchor.constraint(equalTo: b.leadingAnchor),
        blur.trailingAnchor.constraint(equalTo: b.trailingAnchor),
        blur.topAnchor.constraint(equalTo: b.topAnchor),
        blur.bottomAnchor.constraint(equalTo: b.bottomAnchor),
      ])
      b.backgroundColor = .clear
    }
    // Press feedback (visual + sound + haptic). Firing on touchDown so the key
    // feels alive at the moment of contact — Apple's exact behavior.
    b.addTarget(self, action: #selector(keyTouchDown(_:)), for: .touchDown)
    b.addTarget(self, action: #selector(keyTouchUp(_:)),
                for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    // Remember the resting background so touchUp can restore it after the
    // inversion swap. Uses associated object so per-instance color survives
    // across renderer rebuilds.
    objc_setAssociatedObject(b, &Self.keyBaseColorKey, base, .OBJC_ASSOCIATION_RETAIN)
    return b
  }

  private static var keyBaseColorKey: UInt8 = 0
  private static var keyPressedColorKey: UInt8 = 0

  @objc private func keyTouchDown(_ btn: UIButton) {
    // Apple's inversion: letter keys press to function color, function keys
    // press to letter color. We don't know which side a key is on, so use
    // theme.keyPressed if present, else lighten the base color.
    let pressed: UIColor
    if let hex = theme?.keyPressed {
      pressed = UIColor(tulmiHex: hex)
    } else {
      pressed = UIColor(white: 0.5, alpha: 0.3)
    }
    objc_setAssociatedObject(btn, &Self.keyPressedColorKey, pressed, .OBJC_ASSOCIATION_RETAIN)
    // Instant background swap on touch-down (Apple's key press is instant on
    // press-in — the *release* is what's animated). Combined with the animated
    // touchUp below, this gives the "soft glow fade" that reads as premium.
    btn.backgroundColor = pressed
    // System input-click sound. Only plays when the extension conforms to
    // UIInputViewAudioFeedback (see KeyboardViewController extension) AND the
    // user has "Keyboard Feedback → Sound" on in Settings — otherwise silent.
    UIDevice.current.playInputClick()
    fireKeyHaptic()
    showKeyCallout(for: btn)
  }

  @objc private func keyTouchUp(_ btn: UIButton) {
    hideKeyCallout()
    let base = (objc_getAssociatedObject(btn, &Self.keyBaseColorKey) as? UIColor) ?? keyBgColor()
    // Backend flag: kb.press.fadeMs (default 120) — release animation length.
    // 0 or negative → instant snap-back (native style is 60-120ms).
    let ms = flagDouble("kb.press.fadeMs", 120)
    if ms <= 0 {
      btn.backgroundColor = base
      return
    }
    UIView.animate(withDuration: ms / 1000.0,
                   delay: 0,
                   options: [.curveEaseOut, .allowUserInteraction, .beginFromCurrentState],
                   animations: { btn.backgroundColor = base },
                   completion: nil)
  }

  // MARK: - KeyPlaneView callbacks (multi-touch typing layer)
  //
  // The plane owns touch for the character keys when kb.keyPlane.enabled; it
  // drives the SAME press visual / haptic and the SAME insert action a button
  // tap would, so behavior is identical — just with rolling + multi-touch.

  /// Number of fingers currently pressing keys on the multi-touch plane. The
  /// single shared callout can only sensibly track ONE finger, so 2+ suppress it.
  private var planeActiveTouchCount = 0

  /// Press-down visual + click + haptic for the key under a finger.
  fileprivate func planeDown(_ button: UIButton) {
    planeActiveTouchCount += 1
    keyTouchDown(button)
  }

  /// Restore a key's resting visual when a finger leaves it (roll-off or lift).
  fileprivate func planeUp(_ button: UIButton) {
    planeActiveTouchCount = max(0, planeActiveTouchCount - 1)
    keyTouchUp(button)
  }

  /// Commit the character under the finger on release. Routes through the exact
  /// insertKey path a button tap uses, so live shift / capsLock casing applies.
  fileprivate func planeCommit(char: String) { run(.inline(.insertKey(char: char))) }

  /// Selection-changed haptic on every key. Requires Full Access to fire; the
  /// generator silently no-ops without it. Cheaper than instantiating a new
  /// generator per tap.
  private var selectionGenerator: UISelectionFeedbackGenerator?
  fileprivate func fireKeyHaptic() {
    guard host?.hostHasFullAccess == true else { return }
    if selectionGenerator == nil { selectionGenerator = UISelectionFeedbackGenerator() }
    selectionGenerator?.selectionChanged()
    selectionGenerator?.prepare() // pre-cache the next one
  }

  // MARK: - Key-pop callout (native magnified bubble)

  private var calloutView: KeyCalloutView?

  /// Show the native key-pop balloon above a pressed LETTER key. Fired from
  /// keyTouchDown — which both the plain-button path and the KeyPlaneView rolling
  /// path (planeDown → keyTouchDown) route through — so the bubble follows the
  /// finger key-to-key during a rolling slide with no extra wiring. Gated to
  /// single alphabetic glyphs so it never pops over numbers/symbols/space/return
  /// (matching iOS, which only pops letters). OTA-disable via kb.callout.enabled.
  private func showKeyCallout(for btn: UIButton) {
    guard flagBool("kb.callout.enabled", true), let container = mountContainer else { return }
    // One shared balloon can't follow two fingers; with 2+ down on the plane
    // they'd fight over it (flicker / stale glyph), so suppress it entirely.
    guard planeActiveTouchCount <= 1 else { hideKeyCallout(); return }
    guard let title = btn.title(for: .normal), title.count == 1,
          let ch = title.first, ch.isLetter else { hideKeyCallout(); return }
    let rect = container.convert(btn.bounds, from: btn)
    let cv = calloutView ?? KeyCalloutView(frame: .zero)
    calloutView = cv
    cv.present(keyRect: rect, char: title, in: container,
               bg: calloutBgColor(), text: calloutTextColor(), glyphSize: 24)
  }

  private func hideKeyCallout() { calloutView?.isHidden = true }

  /// Balloon fill. Backend override kb.callout.bg (hex); else native default —
  /// white on light themes, a lighter-than-key gray on dark ones.
  private func calloutBgColor() -> UIColor {
    let hex = flagString("kb.callout.bg", "")
    if !hex.isEmpty { return UIColor(tulmiHex: hex) }
    return keyIsDark(keyBgColor()) ? UIColor(white: 0.30, alpha: 1) : .white
  }
  /// Balloon glyph color. Backend override kb.callout.text (hex); else native
  /// default — white on dark themes, near-black on light ones.
  private func calloutTextColor() -> UIColor {
    let hex = flagString("kb.callout.text", "")
    if !hex.isEmpty { return UIColor(tulmiHex: hex) }
    return keyIsDark(keyBgColor()) ? .white : UIColor(white: 0.11, alpha: 1)
  }
  private func keyIsDark(_ c: UIColor) -> Bool {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    c.getRed(&r, green: &g, blue: &b, alpha: &a)
    return 0.299 * r + 0.587 * g + 0.114 * b < 0.5
  }

  private func keyBgColor() -> UIColor {
    if let key = theme?.key { return UIColor(tulmiHex: key) }
    return UIColor(red: 0.11, green: 0.11, blue: 0.15, alpha: 1)
  }
  private func keyTextColor() -> UIColor {
    if let t = theme?.keyText { return UIColor(tulmiHex: t) }
    return .white
  }

  // MARK: - Generic icon resolver + remote cache
  //
  // Backend can specify a button's icon in any of these shapes:
  //
  //   props: { icon: { sf: "mic.fill" } }                 // SF Symbol
  //   props: { icon: { asset: "TailzuMark" } }            // bundled asset
  //   props: { icon: { url: "https://cdn/mark@3x.png" } } // remote — cached
  //   props: { icon: { emoji: "🎙️" } }                  // renders as text
  //   props: { icon: "sf:mic.fill" }                      // string shorthand
  //   props: { icon: "asset:TailzuMark" }
  //   props: { icon: "https://cdn/mark.png" }
  //
  // The whole point: no Swift change is needed to swap an icon. Bundled + SF
  // are instant; remote resolves async and the button re-renders when the
  // download finishes.
  private var remoteImageCache: [String: UIImage] = [:]
  private var remoteImageInflight: Set<String> = []

  /// Resolve an icon spec from `props.icon` (or similar). Returns a UIImage
  /// synchronously for SF symbols and bundled assets; for URLs, returns any
  /// cached image immediately and kicks off a fetch. `onLoad` fires when a
  /// URL fetch completes so the caller can refresh the affected button.
  fileprivate func resolveIcon(_ spec: KBJSON?, onLoad: (() -> Void)? = nil) -> UIImage? {
    guard let spec = spec else { return nil }
    // Object form: { sf } / { asset } / { url } / { emoji }.
    if case .object(let o) = spec {
      if case .string(let sf) = (o["sf"] ?? .null) {
        return UIImage(systemName: sf)?.withRenderingMode(.alwaysTemplate)
      }
      if case .string(let asset) = (o["asset"] ?? .null) {
        return UIImage(named: asset, in: Bundle.main, compatibleWith: nil)?
          .withRenderingMode(.alwaysTemplate)
      }
      if case .string(let url) = (o["url"] ?? .null) {
        return fetchRemoteImage(url, onLoad: onLoad)
      }
      // emoji is rendered by the button title path — resolveIcon returns nil so
      // the caller falls through to setTitle. Callers should check emojiText
      // via iconEmoji(spec) helper below.
      return nil
    }
    // Shorthand string form.
    if case .string(let s) = spec {
      if s.hasPrefix("sf:") {
        return UIImage(systemName: String(s.dropFirst(3)))?
          .withRenderingMode(.alwaysTemplate)
      }
      if s.hasPrefix("asset:") {
        return UIImage(named: String(s.dropFirst(6)), in: Bundle.main, compatibleWith: nil)?
          .withRenderingMode(.alwaysTemplate)
      }
      if s.hasPrefix("https://") || s.hasPrefix("http://") {
        return fetchRemoteImage(s, onLoad: onLoad)
      }
    }
    return nil
  }

  /// Extract an emoji glyph from an icon spec, if that's how it was specified.
  /// Used by button builders to `setTitle(emoji)` instead of an image.
  fileprivate func iconEmoji(_ spec: KBJSON?) -> String? {
    guard let spec = spec else { return nil }
    if case .object(let o) = spec, case .string(let e) = (o["emoji"] ?? .null) { return e }
    return nil
  }

  /// Return a cached remote image if we have one; else start a URLSession
  /// download and call `onLoad` when it lands. The cache is persistent across
  /// keyboard sessions via the app-group container so a single fetch serves
  /// every open of the keyboard until the URL changes.
  private func fetchRemoteImage(_ url: String, onLoad: (() -> Void)?) -> UIImage? {
    if let img = remoteImageCache[url] { return img }
    // Persistent-disk lookup.
    if let img = loadPersistedRemoteImage(url) {
      remoteImageCache[url] = img
      return img
    }
    // Start the download (only once per URL per session).
    if remoteImageInflight.contains(url) { return nil }
    guard let u = URL(string: url) else { return nil }
    remoteImageInflight.insert(url)
    URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
      guard let self = self else { return }
      DispatchQueue.main.async {
        self.remoteImageInflight.remove(url)
        // Route through TulmiImageLoader.decode-style so GIF / APNG land as
        // an animatedImage instead of a frozen first frame. Delegating to
        // that helper's cache also means both the SDUI + hand-built paths
        // share the same warm memory across keyboard opens.
        guard let d = data else { return }
        guard let img = self.decodeAnimated(d) else { return }
        self.remoteImageCache[url] = img
        self.persistRemoteImage(data: d, url: url)
        onLoad?()
      }
    }.resume()
    return nil
  }

  /// Decode a downloaded blob as either a static image or a multi-frame
  /// animated one (GIF / APNG). Delegates to TulmiImageLoader.decode — the
  /// SINGLE downscaling decoder — so a large animated GIF pushed as the mic
  /// icon can't unpack to full-resolution frames and OOM-kill the extension.
  /// (This method previously ran its own full-res CGImageSourceCreateImageAtIndex
  /// loop with no downscale, which busted the ~48MB keyboard memory ceiling.)
  private func decodeAnimated(_ data: Data) -> UIImage? {
    return TulmiImageLoader.decode(data)
  }

  private func remoteImageCacheDir() -> URL? {
    let fm = FileManager.default
    // Prefer the app-group container so main app + extension share the cache.
    // Was "group.com.tulmi.shared" — a group the extension is NOT entitled to, so
    // containerURL returned nil and the cache silently fell back to the private
    // caches dir (never shared). Reference the canonical constant so it can't
    // drift from the group used everywhere else.
    let group = fm.containerURL(forSecurityApplicationGroupIdentifier: TulmiFlow.appGroup)
    let base = group ?? fm.urls(for: .cachesDirectory, in: .userDomainMask).first
    guard let root = base?.appendingPathComponent("keyboard-icons", isDirectory: true) else { return nil }
    if !fm.fileExists(atPath: root.path) {
      try? fm.createDirectory(at: root, withIntermediateDirectories: true)
    }
    return root
  }

  private func remoteImageFile(for url: String) -> URL? {
    guard let dir = remoteImageCacheDir() else { return nil }
    // Cheap URL → filename hash (djb2-ish). Not for security — just uniqueness.
    var h: UInt64 = 5381
    for ch in url.unicodeScalars { h = (h << 5) &+ h &+ UInt64(ch.value) }
    return dir.appendingPathComponent(String(h, radix: 36) + ".img")
  }

  private func loadPersistedRemoteImage(_ url: String) -> UIImage? {
    guard let f = remoteImageFile(for: url),
          let data = try? Data(contentsOf: f) else { return nil }
    // Same GIF/APNG handling as the network path so a cached animated file
    // reanimates on the next open of the keyboard.
    return decodeAnimated(data)
  }

  private func persistRemoteImage(data: Data, url: String) {
    guard let f = remoteImageFile(for: url) else { return }
    try? data.write(to: f, options: .atomic)
  }

  // MARK: - Tap binding

  /// Attach the primary tap handler for a component. Priority: an explicit
  /// `on.onPress` action wins; otherwise fall back to the component's default.
  private func bindTap(_ btn: UIButton, node: KBNode, defaultAction: KBActionSpec?) {
    if let ref = node.on?["onPress"] {
      let action = UIAction { [weak self] _ in self?.run(ref) }
      btn.addAction(action, for: .touchUpInside)
    } else if let def = defaultAction {
      let action = UIAction { [weak self] _ in self?.run(.inline(def)) }
      btn.addAction(action, for: .touchUpInside)
    }
  }

  // MARK: - Action interpreter

  /// Resolve a KBActionRef (string alias or inline spec) into a KBActionSpec.
  /// String aliases are looked up in the top-level `config.actions` map.
  private func resolve(_ ref: KBActionRef) -> KBActionSpec? {
    switch ref {
    case .inline(let spec): return spec
    case .named(let name):  return config.actions?[name]
    }
  }

  /// Run an action ref through the interpreter switch. All side-effecting
  /// user gestures land here.
  func run(_ ref: KBActionRef) {
    guard let spec = resolve(ref) else { return }
    let proxy = host?.hostTextDocumentProxy
    switch spec {
    case .insertText(let text):
      proxy?.insertText(applySmartPunctuation(text))
      updateAutoCap()
    case .insertKey(let char):
      // Derive case from LIVE state at tap time (not baked at render) so the
      // fast-shift in-place re-title never desyncs from what actually inserts.
      // Mirrors buildLetterKey's title logic: single-char → cased, multi-char
      // (or symbol/digit payloads) → inserted verbatim.
      let cased = char.count == 1
        ? ((state.shift || state.capsLock) ? char.uppercased() : char.lowercased())
        : char
      proxy?.insertText(applySmartPunctuation(cased))
      // A character between two shift taps breaks the double-tap-caps chain, so
      // clear the timer — otherwise "shift, type a, shift" wrongly engaged caps.
      lastShiftTapTime = 0
      if state.shift && !state.capsLock {
        state.shift = false
        stateChanged()
      }
      updateAutoCap()
    case .deleteBackward:
      proxy?.deleteBackward()
      updateAutoCap()
    case .deleteWord:
      guard let p = proxy else { return }
      // Delete back until a whitespace/newline or the document is empty.
      // Bounded to avoid pathological loops on unusual editors.
      var deleted = 0
      while deleted < 1000 {
        let ctx = p.documentContextBeforeInput ?? ""
        guard let last = ctx.last else { break }
        p.deleteBackward()
        deleted += 1
        if last.isWhitespace || last.isNewline { break }
      }
    case .shift:
      state.shift.toggle()
      stateChanged()
    case .capsLock:
      state.capsLock.toggle()
      state.shift = state.capsLock ? true : state.shift
      stateChanged()
    case .returnKey:
      proxy?.insertText("\n")
    case .switchLayout(let language):
      let langs = (config.layouts ?? []).map { $0.language }
      if let target = language, langs.contains(target) {
        state.layoutId = target
      } else if !langs.isEmpty {
        let idx = langs.firstIndex(of: state.layoutId) ?? -1
        state.layoutId = langs[(idx + 1) % langs.count]
      }
      stateChanged()
    case .showLanguageMenu:
      presentLanguageMenu()
    case .startDictation:
      state.dictating = true
      stateChanged()
      host?.hostStartDictation()
    case .stopDictation:
      state.dictating = false
      stateChanged()
      host?.hostStopDictation()
    case .runRefine:
      state.refining = true
      stateChanged()
      host?.hostRunRefine()
    case .cycleTone:
      // Cycle through the tones list — either the backend-provided list at
      // config.flags["kb.tones"] or the shipped default set. Result stored
      // in state.tone; the SDUI tools bar rebinds on remount.
      let tones = configuredTones()
      let idx = tones.firstIndex(of: state.tone) ?? -1
      state.tone = tones[(idx + 1) % max(1, tones.count)]
      stateChanged()
      // Publish to the shared App Group so the main app can pick up the
      // current tone selection when it needs to (e.g. for the tone-based
      // refine prompt).
      let d = UserDefaults(suiteName: "group.com.tulmi.app")
      d?.set(state.tone, forKey: "tulmi.kb.tone")
      fireKeyHaptic()
    case .openApp(let screenId):
      // Apple restricts NSExtensionContext.open to Today extensions; keyboard
      // extensions cannot launch URLs directly. We drop a tombstone in the
      // shared App Group and the main app picks it up on next foreground.
      let target = (screenId?.isEmpty == false) ? "screen/\(screenId!)" : ""
      writeDeepLinkTombstone(path: target)
    case .openSettings:
      // Same restriction — tombstone with a well-known path that the app
      // routes to `openSettings()` on foreground.
      writeDeepLinkTombstone(path: "openSettings")
    case .haptic(let style):
      fireHaptic(style)
    case .sequence(let actions):
      runSequence(actions, from: 0)
    case .parallel(let actions):
      // Actions run "at the same time" from the tree's POV. For side-effecting
      // ops (haptic, log, network) they truly run concurrently; for state
      // mutations they still serialize on the main queue but the point is
      // authorial intent — no ordering guarantee.
      for a in actions {
        DispatchQueue.main.async { [weak self] in self?.run(a) }
      }
    case .condition(let cond, let thenA, let elseA):
      if evaluate(cond) { run(thenA) }
      else if let e = elseA { run(e) }
    case .delay(let ms):
      // A pause primitive. It only means something INSIDE a sequence, where
      // runSequence() intercepts it and defers the remaining actions by `ms`
      // (haptic → delay 100 → toast). Reached here only when run directly at the
      // top level, with no following action to defer — so a standalone no-op.
      _ = ms
    case .openUrl(let url, _):
      // Extensions can't UIApplication.open directly; drop a tombstone in the
      // app group. Main app picks it up on next foreground.
      writeDeepLinkTombstone(path: "openUrl?u=\(url)")
    case .toast(let msg, let tone):
      showToast(message: msg, tone: tone)
    case .confetti:
      // Confetti rendered as a short-lived CAEmitterLayer over the mount.
      fireConfetti()
    case .speak(let text, let voice):
      speak(text: text, voice: voice)
    case .playMedia(let url):
      playMedia(url: url)
    case .stopMedia:
      stopMedia()
    case .copyToClipboard(let text, let toastMessage):
      UIPasteboard.general.string = text
      if let m = toastMessage { showToast(message: m, tone: "success") }
    case .readClipboard(let assignTo):
      let clip = UIPasteboard.general.string ?? ""
      writeStatePath(assignTo, .string(clip))
      stateChanged()
    case .share(let text, let url, let title):
      var items: [Any] = []
      if let t = text, !t.isEmpty { items.append(t) }
      if let u = url, let real = URL(string: u) { items.append(real) }
      if items.isEmpty { return }
      let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
      if let t = title { vc.setValue(t, forKey: "subject") }
      host?.hostPresent(vc)
    case .setState(let path, let value):
      writeStatePath(path, value)
      stateChanged()
    case .toggleState(let path):
      let current = lookup("state.\(path)")
      let flipped: KBJSON = truthy(current) ? .bool(false) : .bool(true)
      writeStatePath(path, flipped)
      stateChanged()
    case .incrementState(let path, let by):
      let current = lookup("state.\(path)").asDouble ?? 0
      writeStatePath(path, .number(current + by))
      stateChanged()
    case .clearState(let path):
      writeStatePath(path, .null)
      stateChanged()
    case .callEndpoint(let method, let path, let body, let assignTo, let onSuccess, let onError):
      callEndpoint(method: method, path: path, body: body, assignTo: assignTo, onSuccess: onSuccess, onError: onError)
    case .analyticsTrack(let event, let props):
      // Extensions can't hit our analytics SDK directly (memory + sandbox);
      // drop an event tombstone in the app group and the main app forwards
      // on next foreground.
      writeAnalyticsTombstone(event: event, props: props)
    case .log(let msg, let level):
      NSLog("[kb %@] %@", level, msg)
    case .clearCache:
      remoteImageCache.removeAll()
      if let dir = remoteImageCacheDir() {
        try? FileManager.default.removeItem(at: dir)
      }
    case .reloadApp:
      // Reboots the SDUI tree only — the extension process itself stays up.
      remount()
    case .extensionAction(let name, let params):
      // Look up in the registered extension handlers. Unknown → no-op (safe
      // for pushing forward-looking actions to old builds).
      if let handler = Self.extensionHandlers[name] {
        handler(self, params ?? .null)
      } else {
        NSLog("[kb ext] no handler for %@", name)
      }
    case .unknown(let kind):
      NSLog("unknown kb action: %@", kind)
    }
  }

  /// Execute a sequence one action at a time, honoring `delay(ms)` as a REAL
  /// pause: when a delay is reached the remaining actions run after
  /// asyncAfter(ms). A sequence with no delays runs synchronously in order,
  /// exactly as the old `for a in actions { run(a) }` did.
  private func runSequence(_ actions: [KBActionRef], from index: Int) {
    var i = index
    while i < actions.count {
      let ref = actions[i]
      if case .delay(let ms)? = resolve(ref), ms > 0 {
        let next = i + 1
        DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000.0) { [weak self] in
          self?.runSequence(actions, from: next)
        }
        return
      }
      run(ref)
      i += 1
    }
  }

  // MARK: - Extension handler registry
  //
  // Native code can register a named handler at app launch time:
  //     SDUIRenderer.registerExtension("myCustomVoice") { renderer, params in ... }
  // Then backend can fire it as { kind: "extension", name: "myCustomVoice", params: {...} }.
  // Unknown names silently no-op so backend can push handlers older builds don't
  // have yet without a crash.
  private static var extensionHandlers: [String: (SDUIRenderer, KBJSON) -> Void] = [:]
  static func registerExtension(_ name: String, handler: @escaping (SDUIRenderer, KBJSON) -> Void) {
    extensionHandlers[name] = handler
  }

  // MARK: - State path writer (for setState / readClipboard / callEndpoint.assignTo)
  //
  // Writes a KBJSON value into state.user.<path> — a scratch dict that backend
  // can freely read/write via bind + visibleIf. Reserved for backend use;
  // native state fields (shift, dictating, etc.) are not writable via this path.
  private func writeStatePath(_ path: String, _ value: KBJSON) {
    // Store the value with its REAL type. The old asString-first round-trip
    // coerced setState(path, 5) into .string("5.0"), so a later eq:[path, 5]
    // (a .number) never matched (equal() compares by case). Only .null is
    // special-cased, mapping to a removal.
    if case .null = value { state.user.removeValue(forKey: path) }
    else { state.user[path] = value }
  }

  // MARK: - Toast (transient label at the bottom of the keyboard)
  private weak var toastView: UILabel?
  private func showToast(message: String, tone: String) {
    // Backend flags:
    //   kb.toast.durationMs   (default 2000) — visible time before fade begins
    //   kb.toast.fadeInMs     (default 180)
    //   kb.toast.fadeOutMs    (default 250)
    //   kb.toast.height       (default 32)
    //   kb.toast.offsetY      (default -18) — negative = above bottom anchor
    //   kb.toast.fontSize     (default 13)
    //   kb.toast.color.error   (default "#FF3B30E6")
    //   kb.toast.color.success (default "#34C759E6")
    //   kb.toast.color.info    (default "#000000D9")
    guard let container = mountContainer else { return }
    toastView?.removeFromSuperview()
    let l = UILabel()
    l.text = message
    l.textColor = .white
    l.textAlignment = .center
    l.font = .systemFont(ofSize: flagCGFloat("kb.toast.fontSize", 13), weight: .medium)
    let bg: UIColor = {
      switch tone {
      case "error":   return flagColor("kb.toast.color.error", "#FF3B30E6")
      case "success": return flagColor("kb.toast.color.success", "#34C759E6")
      default:        return flagColor("kb.toast.color.info", "#000000D9")
      }
    }()
    l.backgroundColor = bg
    l.layer.cornerRadius = 8
    l.clipsToBounds = true
    l.translatesAutoresizingMaskIntoConstraints = false
    l.alpha = 0
    container.addSubview(l)
    NSLayoutConstraint.activate([
      l.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      l.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: flagCGFloat("kb.toast.offsetY", -18)),
      l.heightAnchor.constraint(equalToConstant: flagCGFloat("kb.toast.height", 32)),
      l.widthAnchor.constraint(lessThanOrEqualTo: container.widthAnchor, multiplier: 0.9),
    ])
    l.layoutMargins = UIEdgeInsets(top: 6, left: 14, bottom: 6, right: 14)
    toastView = l
    let fadeIn = flagDouble("kb.toast.fadeInMs", 180) / 1000.0
    let duration = flagDouble("kb.toast.durationMs", 2000) / 1000.0
    let fadeOut = flagDouble("kb.toast.fadeOutMs", 250) / 1000.0
    UIView.animate(withDuration: fadeIn) { l.alpha = 1 }
    DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak l] in
      UIView.animate(withDuration: fadeOut, animations: { l?.alpha = 0 },
                     completion: { _ in l?.removeFromSuperview() })
    }
  }

  // MARK: - Confetti (short-lived CAEmitterLayer)
  private func fireConfetti() {
    guard let container = mountContainer else { return }
    let emitter = CAEmitterLayer()
    // Backend flags:
    //   kb.confetti.colors       (default 6 system colors) — array of hex strings
    //   kb.confetti.birthRate    (default 6)   — particles/sec per color cell
    //   kb.confetti.lifetimeMs   (default 3000)
    //   kb.confetti.velocity     (default 200) — pt/sec
    //   kb.confetti.spin         (default 3)   — rad/sec
    //   kb.confetti.scale        (default 0.06)
    //   kb.confetti.burstMs      (default 400) — birth cutoff
    //   kb.confetti.teardownMs   (default 3500)
    emitter.emitterPosition = CGPoint(x: container.bounds.midX, y: -10)
    emitter.emitterShape = .line
    emitter.emitterSize = CGSize(width: container.bounds.width, height: 1)
    let defaultColors = ["#FF3B30","#007AFF","#34C759","#FFCC00","#AF52DE","#FF9500"]
    let hexList: [String] = {
      if case .array(let a)? = config.flags?["kb.confetti.colors"] {
        return a.compactMap { $0.asString }
      }
      return defaultColors
    }()
    let birthRate = Float(flagDouble("kb.confetti.birthRate", 6))
    let lifetime = Float(flagDouble("kb.confetti.lifetimeMs", 3000) / 1000.0)
    let velocity = flagCGFloat("kb.confetti.velocity", 200)
    let spin = flagCGFloat("kb.confetti.spin", 3)
    let scale = flagCGFloat("kb.confetti.scale", 0.06)
    emitter.emitterCells = hexList.map { hex in
      let cell = CAEmitterCell()
      cell.birthRate = birthRate
      cell.lifetime = lifetime
      cell.velocity = velocity
      cell.velocityRange = velocity * 0.2
      cell.emissionLongitude = .pi
      cell.emissionRange = 0.5
      cell.spin = spin
      cell.spinRange = spin * 1.3
      cell.scale = scale
      cell.color = UIColor(tulmiHex: hex).cgColor
      cell.contents = UIImage(systemName: "square.fill")?.cgImage
      return cell
    }
    container.layer.addSublayer(emitter)
    let burst = flagDouble("kb.confetti.burstMs", 400) / 1000.0
    let teardown = flagDouble("kb.confetti.teardownMs", 3500) / 1000.0
    DispatchQueue.main.asyncAfter(deadline: .now() + burst) { emitter.birthRate = 0 }
    DispatchQueue.main.asyncAfter(deadline: .now() + teardown) { emitter.removeFromSuperlayer() }
  }

  // MARK: - TTS (AVSpeechSynthesizer)
  private var speechSynth: AVSpeechSynthesizer?
  private func speak(text: String, voice: String?) {
    if speechSynth == nil { speechSynth = AVSpeechSynthesizer() }
    let utter = AVSpeechUtterance(string: text)
    if let v = voice, let sv = AVSpeechSynthesisVoice(language: v) { utter.voice = sv }
    speechSynth?.speak(utter)
  }

  // MARK: - Media (AVPlayer, opt-in)
  private var mediaPlayer: AVPlayer?
  private func playMedia(url: String) {
    guard let u = URL(string: url) else { return }
    let p = AVPlayer(url: u)
    mediaPlayer = p
    p.play()
  }
  private func stopMedia() {
    mediaPlayer?.pause()
    mediaPlayer = nil
  }

  // MARK: - callEndpoint
  //
  // Small helper so backend can trigger arbitrary POST/GET from the keyboard.
  // Uses the same base URL the config was fetched from. Result body (if JSON
  // and assignTo is set) lands at state.user[assignTo]. onSuccess/onError refs
  // run after the response is decoded.
  private func callEndpoint(method: String, path: String, body: KBJSON?,
                            assignTo: String?, onSuccess: KBActionRef?, onError: KBActionRef?) {
    let base = TulmiBackend.baseUrl
    guard let url = URL(string: base + path) else { return }
    // Backend flag: kb.network.timeoutMs (default 15000) — request timeout for
    // callEndpoint invocations. Default was iOS's implicit 60s which is way
    // too long on a bad network.
    var req = URLRequest(url: url)
    req.httpMethod = method.uppercased()
    req.timeoutInterval = flagDouble("kb.network.timeoutMs", 15000) / 1000.0
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let body = body, let data = try? JSONEncoderSafe.data(for: body) {
      req.httpBody = data
    }
    URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
      DispatchQueue.main.async {
        guard let self = self else { return }
        let ok = (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        if let err = err {
          NSLog("[kb callEndpoint] %@", "\(err)")
        }
        if ok, let d = data, let json = try? JSONDecoder().decode(KBJSON.self, from: d) {
          if let key = assignTo { self.writeStatePath(key, json); self.stateChanged() }
          if let ok = onSuccess { self.run(ok) }
        } else {
          if let er = onError { self.run(er) }
        }
      }
    }.resume()
  }

  // MARK: - Analytics tombstone (extension → main app hand-off; deep-link
  // tombstone helper is defined once, further down)
  private func writeAnalyticsTombstone(event: String, props: KBJSON?) {
    let d = UserDefaults(suiteName: "group.com.tulmi.app")
    var log = d?.array(forKey: "tulmi.analytics.pending") as? [[String: Any]] ?? []
    var entry: [String: Any] = ["event": event, "at": Int(0)]  // timestamp filled by main app
    if let p = props, case .object(let o) = p {
      var props2: [String: Any] = [:]
      for (k, v) in o { props2[k] = JSONEncoderSafe.lower(v) }
      entry["props"] = props2
    }
    log.append(entry)
    d?.set(log, forKey: "tulmi.analytics.pending")
  }

  private func fireHaptic(_ style: String) {
    switch style {
    case "light":
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
    case "medium":
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    case "heavy":
      UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
    case "selection":
      UISelectionFeedbackGenerator().selectionChanged()
    case "success":
      UINotificationFeedbackGenerator().notificationOccurred(.success)
    case "warning":
      UINotificationFeedbackGenerator().notificationOccurred(.warning)
    case "error":
      UINotificationFeedbackGenerator().notificationOccurred(.error)
    default:
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
  }

  // MARK: - Auto-capitalization

  /// Called after every insert / delete. Reads the text before the cursor and
  /// arms state.shift when the next character is at a sentence boundary:
  ///   - field start (nothing before cursor)
  ///   - immediately after ". " or "? " or "! " or newline
  /// Respects the field's autocapitalizationType — off entirely on URL /
  /// email / password fields, .allCharacters keeps shift on always,
  /// .words fires on every word boundary.
  private func updateAutoCap() {
    // Backend flag: kb.autoCap.enabled (default true) — global auto-cap kill switch
    guard flagBool("kb.autoCap.enabled", true) else { return }
    guard let host = host else { return }
    let mode = host.hostAutocapitalizationType()
    if mode == .none { return }
    let ctx = host.hostTextDocumentProxy.documentContextBeforeInput ?? ""
    let shouldCap: Bool
    switch mode {
    case .allCharacters:
      shouldCap = true
    case .words:
      shouldCap = ctx.isEmpty || (ctx.last?.isWhitespace ?? true)
    case .sentences:
      if ctx.isEmpty { shouldCap = true }
      else {
        // Look back past trailing whitespace, then check the last non-space
        // for a sentence-ending mark.
        let trimmed = ctx.reversed().drop(while: { $0.isWhitespace })
        let hadSpace = ctx.count != trimmed.count
        if let last = trimmed.first {
          shouldCap = hadSpace && (last == "." || last == "?" || last == "!" || last == "\n")
        } else {
          shouldCap = true
        }
      }
    @unknown default:
      shouldCap = false
    }
    if state.capsLock { return } // caps lock wins; don't fight the user
    if shouldCap != state.shift {
      state.shift = shouldCap
      stateChanged()
    }
  }

  // MARK: - Smart punctuation

  /// Server-controlled toggle key. When flags["kb.smartPunctuation"] is truthy
  /// (default), we run typed characters through this cleaner:
  ///   `"` → curly quote (open/close by odd/even count in the buffer)
  ///   `--` → em-dash (delete the trailing "-" first)
  ///   `...` → single ellipsis codepoint (delete the trailing ".." first)
  /// Everything else passes through untouched.
  private func applySmartPunctuation(_ text: String) -> String {
    let on: Bool = {
      if let f = config.flags?["kb.smartPunctuation"]?.asBool { return f }
      return true
    }()
    guard on, text.count == 1 else { return text }
    let ch = text.first!
    guard let proxy = host?.hostTextDocumentProxy else { return text }
    let ctx = proxy.documentContextBeforeInput ?? ""
    switch ch {
    case "\"":
      // Toggle straight → curly. Count existing straight " in the paragraph
      // is unreliable; simplest heuristic: last char is a word char → close.
      let last = ctx.last
      if last == nil || last?.isWhitespace == true || last == "\n" { return "\u{201C}" }
      return "\u{201D}"
    case "'":
      let last = ctx.last
      if last == nil || last?.isWhitespace == true || last == "\n" { return "\u{2018}" }
      return "\u{2019}"
    case "-":
      if ctx.hasSuffix("-") {
        proxy.deleteBackward()
        return "\u{2014}" // em-dash
      }
      return text
    case ".":
      if ctx.hasSuffix("..") {
        proxy.deleteBackward()
        proxy.deleteBackward()
        return "\u{2026}" // ellipsis
      }
      return text
    default:
      return text
    }
  }

  /// Write a deep-link target into the shared App Group. The main app checks
  /// UserDefaults(suiteName:)?.string(forKey: "tulmi.kb.pendingDeepLink") on
  /// launch/foreground; if present, it routes to that path and clears the key.
  private func writeDeepLinkTombstone(path: String) {
    let d = UserDefaults(suiteName: "group.com.tulmi.app")
    d?.set(path, forKey: "tulmi.kb.pendingDeepLink")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.pendingDeepLinkAt")
  }

  private func presentLanguageMenu() {
    guard let layouts = config.layouts, !layouts.isEmpty else { return }
    let sheet = UIAlertController(title: host?.hostLabel("language", "Language"),
                                  message: nil,
                                  preferredStyle: .actionSheet)
    for layout in layouts {
      let title = layout.displayName ?? layout.language
      sheet.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in
        self?.run(.inline(.switchLayout(language: layout.language)))
      })
    }
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    // iPad requires a sourceView for action sheets or presentation raises.
    // Anchoring on mountContainer keeps the popover on the keyboard surface.
    if let popover = sheet.popoverPresentationController {
      popover.sourceView = mountContainer
      popover.sourceRect = CGRect(
        x: (mountContainer?.bounds.midX ?? 0),
        y: (mountContainer?.bounds.midY ?? 0),
        width: 0, height: 0,
      )
      popover.permittedArrowDirections = []
    }
    host?.hostPresent(sheet)
  }

  // MARK: - Condition evaluator

  /// Evaluate a KBCondition against KBState + config.flags. Mirrors the shape
  /// used by the RN evaluator so backend authors write the same conditions.
  func evaluate(_ cond: KBCondition) -> Bool {
    switch cond {
    case .eq(let p, let v):   return equal(lookup(p), v)
    case .neq(let p, let v):  return !equal(lookup(p), v)
    case .gt(let p, let v):   return (lookupNumber(p) ?? .nan) > v
    case .gte(let p, let v):  return (lookupNumber(p) ?? .nan) >= v
    case .lt(let p, let v):   return (lookupNumber(p) ?? .nan) < v
    case .lte(let p, let v):  return (lookupNumber(p) ?? .nan) <= v
    case .inList(let p, let vs):
      let l = lookup(p)
      return vs.contains { equal(l, $0) }
    case .contains(let p, let s):
      return (lookupString(p) ?? "").contains(s)
    case .startsWith(let p, let s):
      return (lookupString(p) ?? "").hasPrefix(s)
    case .endsWith(let p, let s):
      return (lookupString(p) ?? "").hasSuffix(s)
    case .truthy(let p):
      return truthy(lookup(p))
    case .falsy(let p):
      return !truthy(lookup(p))
    case .flag(let name):
      guard let raw = config.flags?[name] else { return false }
      return truthy(raw)
    case .platform(let n):
      return n == "ios"
    case .not(let inner):
      return !evaluate(inner)
    case .all(let cs):
      return cs.allSatisfy { evaluate($0) }
    case .any_(let cs):
      return cs.contains { evaluate($0) }
    case .unknown:
      return false
    }
  }

  /// Read a path like "state.shift" / "flags.betaEnabled" / "config.layoutId"
  /// out of KBState and config.flags.
  private func lookup(_ path: String) -> KBJSON {
    let parts = path.split(separator: ".").map(String.init)
    guard let head = parts.first else { return .null }
    switch head {
    case "state":
      let key = parts.dropFirst().joined(separator: ".")
      switch key {
      case "shift":                return .bool(state.shift)
      case "capsLock":             return .bool(state.capsLock)
      case "layoutId":             return .string(state.layoutId)
      case "dictating":            return .bool(state.dictating)
      case "refining":             return .bool(state.refining)
      case "hasFullAccess":        return .bool(state.hasFullAccess)
      case "status":               return .string(state.status)
      case "micLevel":             return .number(Double(state.micLevel))
      case "tone":                 return .string(state.tone)
      case "trackpadActive":       return .bool(state.trackpadActive)
      case "primaryLanguage":      return .string(state.primaryLanguage)
      case "hasMultipleKeyboards": return .bool(state.hasMultipleKeyboards)
      case "appearance":           return .string(state.appearance)
      case "deviceModel":          return .string(state.deviceModel)
      case "systemVersion":        return .string(state.systemVersion)
      case "isNetworkReachable":   return .bool(state.isNetworkReachable)
      case "keyboardHeight":       return .number(Double(state.keyboardHeight))
      default:
        // state.user.<anything> — backend scratch dict.
        if key.hasPrefix("user.") {
          return state.user[String(key.dropFirst("user.".count))] ?? .null
        }
        return .null
      }
    case "flags":
      let key = parts.dropFirst().joined(separator: ".")
      return config.flags?[key] ?? .null
    default:
      return .null
    }
  }
  private func lookupNumber(_ path: String) -> Double? { lookup(path).asDouble }
  private func lookupString(_ path: String) -> String? { lookup(path).asString }

  private func truthy(_ v: KBJSON) -> Bool {
    switch v {
    case .null:               return false
    case .bool(let b):        return b
    case .number(let n):      return n != 0
    case .string(let s):      return !s.isEmpty
    case .array(let a):       return !a.isEmpty
    case .object(let o):      return !o.isEmpty
    }
  }
  private func equal(_ a: KBJSON, _ b: KBJSON) -> Bool {
    switch (a, b) {
    case (.null, .null):                     return true
    case (.bool(let x), .bool(let y)):       return x == y
    case (.number(let x), .number(let y)):   return x == y
    case (.string(let x), .string(let y)):   return x == y
    case (.string(let x), .bool(let y)):     return x == (y ? "true" : "false")
    case (.bool(let x), .string(let y)):     return (x ? "true" : "false") == y
    default: return false
    }
  }

  // MARK: - State reflect (called by host)

  func reflectHasFullAccess(_ v: Bool) {
    if state.hasFullAccess == v { return }
    state.hasFullAccess = v
    stateChanged()
  }
  func reflectStatus(_ s: String) {
    if state.status == s { return }
    state.status = s
    stateChanged()
  }
  func reflectDictating(_ v: Bool) {
    if state.dictating == v { return }
    state.dictating = v
    // Stop the 30 FPS timer when dictation ends so the extension isn't
    // draining CPU/battery for a static bar row. It'll be recreated on the
    // next buildWaveform call when dictation restarts.
    if !v {
      waveformTimer?.invalidate()
      waveformTimer = nil
    }
    // Recording visuals — key dimming + dot stream on start; graceful fade
    // (existing dots keep flying for ~2.5s) on stop. Called before
    // stateChanged() so the tree remounts to update the mic icon (brand mark
    // → thick line) in the same runloop that shows the overlay.
    if v {
      showRecordingVisuals()
      // Re-entering recording (possibly mid-reassembly): scatter the dots again.
      micReassembling = false
      currentMicParticles?.beginRecording()
    } else {
      hideRecordingVisuals()
      // Reverse animation: the dots spring back INTO the mark, then hand off to
      // the crisp static mark. Keep buildMicKey rendering the sim until the
      // converge finishes (micReassembling), so the structure re-forms
      // seamlessly instead of snapping back.
      if let particles = currentMicParticles {
        micReassembling = true
        particles.reassemble { [weak self] in
          guard let self = self, self.micReassembling else { return }
          self.micReassembling = false
          self.currentMicParticles = nil
          self.stateChanged()          // final remount → static brand mark
        }
      }
    }
    stateChanged()
  }
  func reflectRefining(_ v: Bool) {
    if state.refining == v { return }
    state.refining = v
    stateChanged()
  }
  func reflectMicLevel(_ l: CGFloat) {
    state.micLevel = l  // no remount — the display link picks it up
  }

  /// Field-context refresh — called by the host on textDidChange (which fires
  /// when the user switches focus between text fields, not just on typing).
  /// Rebuilds the mounted tree only if something the tree actually depends on
  /// changed (returnKeyType / primaryLanguage / hasMultipleKeyboards) so we're
  /// not remounting on every keystroke.
  private var lastReflectedReturnKey: UIReturnKeyType?
  func reflectFieldContext() {
    let rt = host?.hostReturnKeyType() ?? .default
    let lang = host?.hostPrimaryLanguageCode() ?? "EN"
    let multi = host?.hostNeedsInputModeSwitchKey() ?? false
    var changed = false
    if lastReflectedReturnKey != rt         { lastReflectedReturnKey = rt; changed = true }
    if state.primaryLanguage != lang        { state.primaryLanguage = lang; changed = true }
    if state.hasMultipleKeyboards != multi  { state.hasMultipleKeyboards = multi; changed = true }
    if changed { stateChanged() }
  }

  /// Appearance refresh — called by the host on traitCollectionDidChange when
  /// the user flips dark/light. Also syncs the state.appearance string so the
  /// backend tree can bind against it (visibleIf, etc.).
  func reflectAppearance(_ dark: Bool) {
    let val = dark ? "dark" : "light"
    if state.appearance == val { return }
    state.appearance = val
    stateChanged()
  }

  deinit {
    waveformTimer?.invalidate()
    deleteTimer?.invalidate()
  }
}

// MARK: - Waveform bars view

/// Waveform bar array — every geometry / color parameter is passed in so
/// backend flags can tune the look. Baseline heights are random per bar so
/// even at zero micLevel the waveform looks alive.
private final class WaveformView: UIView {
  struct Config {
    let barCount: Int
    let barColor: UIColor
    let barRadius: CGFloat
    let barSpacing: CGFloat
    let height: CGFloat
    let levelMultiplier: CGFloat
    let baselineMin: CGFloat
    let baselineMax: CGFloat
  }
  static let `default` = Config(
    barCount: 24, barColor: UIColor(white: 0.6, alpha: 1), barRadius: 1.5,
    barSpacing: 3, height: 24, levelMultiplier: 0.6,
    baselineMin: 0.2, baselineMax: 0.6,
  )
  private var bars: [CALayer] = []
  private var baselines: [CGFloat] = []
  private var level: CGFloat = 0
  private let cfg: Config

  init(config: Config = WaveformView.default) {
    self.cfg = config
    super.init(frame: .zero)
    for _ in 0..<max(1, config.barCount) {
      let l = CALayer()
      l.backgroundColor = config.barColor.cgColor
      l.cornerRadius = config.barRadius
      layer.addSublayer(l)
      bars.append(l)
      baselines.append(CGFloat.random(in: config.baselineMin...max(config.baselineMin, config.baselineMax)))
    }
    heightAnchor.constraint(equalToConstant: config.height).isActive = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unsupported") }

  override func layoutSubviews() {
    super.layoutSubviews()
    redraw()
  }
  func setLevel(_ l: CGFloat) { level = l; redraw() }

  private func redraw() {
    let W = bounds.width, H = bounds.height
    guard W > 0, H > 0, !bars.isEmpty else { return }
    let n = CGFloat(bars.count)
    let spacing = cfg.barSpacing
    let barW = max(1.5, (W - spacing * (n - 1)) / n)
    let mult = cfg.levelMultiplier
    for (i, l) in bars.enumerated() {
      let jitter = CGFloat.random(in: -0.05...0.05)
      let h = max(2, min(H, H * (baselines[i] + level * mult + jitter)))
      let x = CGFloat(i) * (barW + spacing)
      let y = (H - h) / 2
      l.frame = CGRect(x: x, y: y, width: barW, height: h)
    }
  }
}

// MARK: - Gradient host view

private final class GradientView: UIView {
  var gradientColors: [CGColor] = [] { didSet { setNeedsLayout() } }
  var horizontal: Bool = false      { didSet { setNeedsLayout() } }
  override class var layerClass: AnyClass { CAGradientLayer.self }
  override func layoutSubviews() {
    super.layoutSubviews()
    let g = layer as! CAGradientLayer
    g.colors = gradientColors
    if horizontal {
      g.startPoint = CGPoint(x: 0, y: 0.5); g.endPoint = CGPoint(x: 1, y: 0.5)
    } else {
      g.startPoint = CGPoint(x: 0.5, y: 0); g.endPoint = CGPoint(x: 0.5, y: 1)
    }
  }
}

// MARK: - Config decoder entry point

extension SDUIRenderer {
  /// Decode raw config bytes into a KBConfig. Returns nil on any decode error —
  /// callers fall through to the hand-built path.
  static func decodeConfig(_ data: Data) -> KBConfig? {
    do {
      let dec = JSONDecoder()
      return try dec.decode(KBConfig.self, from: data)
    } catch {
      NSLog("SDUIRenderer.decodeConfig error: %@", "\(error)")
      return nil
    }
  }
}
