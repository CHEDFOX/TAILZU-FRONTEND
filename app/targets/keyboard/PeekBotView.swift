import UIKit

/// THE MIC KEY AS A TINY BOT (kb.mic.bot = "peek").
///
/// The key is a round window. Now and then the bot peeks in from below,
/// holding the rim, and looks around; tap the key and it pops up to listen,
/// ears and antenna pulsing with the voice; while the words are cleaned up
/// it shows thinking dots on its visor; when they land it smiles, a sparkle
/// goes off, and it ducks back down. Everything is springs: the pop
/// bounces, the body squashes and stretches with its speed, the antenna
/// whips and wobbles after a move.
///
/// Ported 1:1 from the design reference (units: the key's radius is 1, the
/// centre is 0,0, y down); Android's TulmiPeekBot.kt carries the same
/// numbers. The renderer feeds it the mic state every frame; the bot works
/// out its own moment from it.
final class PeekBotView: UIView {
  // MARK: Inputs — the renderer points these at its state.
  var dictating: () -> Bool = { false }
  var busy: () -> Bool = { false }
  var level: () -> CGFloat = { 0 }

  // MARK: Look — kb.mic.bot.* colours and timings, set by the renderer.
  var windowColor = UIColor(red: 0.18, green: 0.17, blue: 0.16, alpha: 1)
  var shellTop = UIColor(red: 0.984, green: 0.941, blue: 0.871, alpha: 1)
  var shellBottom = UIColor(red: 0.914, green: 0.816, blue: 0.659, alpha: 1)
  var bodyColor = UIColor(red: 0.886, green: 0.773, blue: 0.604, alpha: 1)
  var visorColor = UIColor(red: 0.114, green: 0.110, blue: 0.106, alpha: 1)
  var glowColor = UIColor(red: 1, green: 0.945, blue: 0.839, alpha: 1)
  var clayColor = UIColor(red: 0.788, green: 0.408, blue: 0.247, alpha: 1)
  var peekMin = 4.0, peekMax = 9.0, doneHold = 1.6

  private enum Mode { case idle, listen, think, done }
  private enum K {
    static let hidden = 1.62, peek = 0.86, up = 0.1
    static let headW = 1.12, headH = 0.86, headR = 0.32
    static let visorW = 0.84, visorH = 0.46, visorR = 0.2, visorY = -0.05
    static let eyeX = 0.19, eyeW = 0.12, eyeH = 0.19
    static let stalk = 0.22, ball = 0.075, earR = 0.1, pawR = 0.1, pawX = 0.5
  }
  /// Damped spring: rate in rad/s, damp the damping ratio (1 critical).
  private struct Spring {
    var x: Double, v = 0.0
    init(_ x: Double) { self.x = x }
    mutating func step(_ to: Double, _ dt: Double, _ rate: Double, _ damp: Double) {
      v += ((to - x) * rate * rate - 2 * damp * rate * v) * dt
      x += v * dt
    }
  }

  private var y = Spring(K.hidden), tilt = Spring(0), lookX = Spring(0), lookY = Spring(0)
  private var ant = Spring(0), ear = Spring(0), glow = Spring(0), think = Spring(0), happy = Spring(0), paws = Spring(0)
  private var mode = Mode.idle, lastMode = Mode.idle
  private var clock = 0.0, lastTick: CFTimeInterval = 0
  private var peekIn = 1.2, peekLeft = 0.0, typingUntil = 0.0
  private var blinkIn = 2.0, blinkT = 0.0, blink = 1.0, sparkle = 0.0
  private var doneAt = -100.0, lastActive = -100.0, wasActive = false, lv = 0.0
  private var link: CADisplayLink?
  private var resting = true

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = false
    contentMode = .redraw
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

  /// A key was pressed: no peeking while someone types.
  func noteTyping() { typingUntil = clock + 1.2 }

  /// Start (or resume) the frame loop; the renderer calls this whenever the
  /// mic's state may have changed. Reduce Motion: one still frame.
  func wake() {
    if UIAccessibility.isReduceMotionEnabled {
      link?.invalidate(); link = nil
      holdStill()
      setNeedsDisplay()
      return
    }
    if link == nil {
      let l = CADisplayLink(target: Ticker(self), selector: #selector(Ticker.tick(_:)))
      l.add(to: .main, forMode: .common)
      link = l
    }
    lastTick = 0
    setActive(true)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { link?.invalidate(); link = nil } else { wake() }
  }

  private func setActive(_ on: Bool) {
    resting = !on
    link?.preferredFramesPerSecond = on ? 60 : 4
  }

  fileprivate func tick() {
    let now = CACurrentMediaTime()
    let dt = lastTick == 0 ? 1.0 / 60 : min(now - lastTick, resting ? 0.5 : 1.0 / 30)
    lastTick = now
    clock += dt
    mode = currentMode()
    // At rest — hidden, still, no peek due — only count down to the next peek.
    if resting {
      if mode == .idle {
        peekIn -= dt
        if peekIn > 0 || clock < typingUntil { return }
      }
      setActive(true)
      lastTick = now
      return
    }
    update(min(dt, 1.0 / 30))
    setNeedsDisplay()
    if mode == .idle, peekLeft <= 0, abs(y.x - K.hidden) < 0.002, abs(y.v) < 0.01, paws.x < 0.01, sparkle <= 0 {
      setActive(false)
    }
  }

  private func currentMode() -> Mode {
    if dictating() { lastActive = clock; wasActive = true; return .listen }
    if busy() { lastActive = clock; wasActive = true; return .think }
    if wasActive {
      // A beat for the clean-up to start after the microphone closes.
      if clock - lastActive < 0.35 { return lastMode == .think ? .think : .listen }
      wasActive = false
      doneAt = clock
    }
    return clock - doneAt < doneHold ? .done : .idle
  }

  private func update(_ dt: Double) {
    let level = mode == .listen ? Double(max(0, min(1, self.level()))) : 0
    lv = level
    if mode != lastMode {
      if mode == .listen && lastMode == .idle { ant.v += 9 }       // the pop flicks the antenna
      if mode == .done { sparkle = 1; ant.v -= 6 }
      lastMode = mode
    }
    // Peeks: idle only, at random, never while typing.
    if mode == .idle {
      if peekLeft > 0 { peekLeft -= dt }
      else if peekIn <= 0 {
        if clock >= typingUntil { peekLeft = 1.8 + Double.random(in: 0...1.4) }
        peekIn = Double.random(in: peekMin...max(peekMin, peekMax))
      } else { peekIn -= dt }
      if clock < typingUntil { peekLeft = min(peekLeft, 0.15) }
    } else { peekLeft = 0 }
    let peeking = mode == .idle && peekLeft > 0
    let sinceDone = clock - doneAt
    let yTo: Double
    switch mode {
    case .listen, .think: yTo = K.up
    case .done: yTo = sinceDone < 1.1 ? K.up - (sinceDone < 0.25 ? 0.12 : 0) : K.hidden
    case .idle: yTo = peeking ? K.peek : K.hidden
    }
    let pop = yTo < y.x
    y.step(yTo, dt, pop ? 15 : 9, pop ? 0.42 : 0.8)
    let t = clock
    let look: (Double, Double)
    switch mode {
    case .idle: look = peeking ? (sin(t * 1.7) * 0.07, -0.02) : (0, 0)
    case .listen: look = (-0.05, -0.04)
    case .think: look = (0.05 * cos(t * 5), -0.05)
    case .done: look = (0, 0)
    }
    lookX.step(look.0, dt, 14, 0.7); lookY.step(look.1, dt, 14, 0.7)
    tilt.step(mode == .listen ? -0.1 + level * 0.05 : mode == .think ? 0.06 * sin(t * 3) : 0, dt, 9, 0.5)
    ear.step(level, dt, 26, 0.6)
    glow.step(mode == .listen ? 0.35 + level * 0.65 : mode == .think ? 0.5 + 0.3 * sin(t * 8) : 0, dt, 22, 0.8)
    think.step(mode == .think ? 1 : 0, dt, 18, 1)
    happy.step(mode == .done && sinceDone < 1.3 ? 1 : 0, dt, 20, 1)
    paws.step(peeking ? 1 : 0, dt, 16, 0.9)
    // Antenna: a pendulum on the head, driven by its tilt and its rise.
    ant.step(-tilt.x * 1.5 + (mode == .listen ? sin(t * 9) * 0.12 * level : 0), dt, 13, 0.18)
    ant.v += -y.v * dt * 1.2 * (ant.x < 0 ? -1 : 1)
    sparkle = max(0, sparkle - dt * 1.1)
    blinkIn -= dt
    if blinkIn <= 0 { blinkIn = 2.2 + Double.random(in: 0...2.8); blinkT = 0.16 }
    if blinkT > 0 { blinkT -= dt; blink = abs(cos((1 - blinkT / 0.16) * .pi)) } else { blink = 1 }
  }

  /// Reduce Motion: the pose of the moment, still — peeking when idle.
  private func holdStill() {
    mode = currentMode()
    lastMode = mode
    switch mode {
    case .listen, .think: y = Spring(K.up)
    case .done: y = Spring(K.up); happy = Spring(1)
    case .idle: y = Spring(K.peek); paws = Spring(1)
    }
    if mode == .think { think = Spring(1) }
    if mode != .done { happy = Spring(0) }
    if mode != .idle { paws = Spring(0) }
  }

  // MARK: Drawing

  override func draw(_ rect: CGRect) {
    guard let c = UIGraphicsGetCurrentContext() else { return }
    let R = min(bounds.width, bounds.height) / 2
    guard R > 1 else { return }
    func u(_ v: Double) -> CGFloat { CGFloat(v) * R }
    func disc(_ x: Double, _ y: Double, _ r: Double, _ col: UIColor) {
      c.setFillColor(col.cgColor)
      c.fillEllipse(in: CGRect(x: u(x - r), y: u(y - r), width: u(2 * r), height: u(2 * r)))
    }
    func rrect(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) -> UIBezierPath {
      UIBezierPath(roundedRect: CGRect(x: u(x), y: u(y), width: u(w), height: u(h)),
                   cornerRadius: max(0, min(u(r), u(w) / 2, u(h) / 2)))
    }
    func fill(_ p: UIBezierPath, _ col: UIColor) { c.setFillColor(col.cgColor); c.addPath(p.cgPath); c.fillPath() }

    c.translateBy(x: bounds.midX, y: bounds.midY)
    let disk = CGRect(x: -R, y: -R, width: 2 * R, height: 2 * R)
    c.saveGState()
    c.addEllipse(in: disk); c.clip()
    c.setFillColor(windowColor.cgColor); c.fill(disk)

    let st = max(-0.14, min(0.2, -y.v * 0.035)), sy = 1 + st, sx = 1 - st * 0.55
    c.saveGState()
    c.translateBy(x: 0, y: u(y.x)); c.rotate(by: CGFloat(tilt.x)); c.scaleBy(x: CGFloat(sx), y: CGFloat(sy))
    // Body, down out of the window
    fill(rrect(-0.34, 0.3, 0.68, 1.4, 0.2), bodyColor)
    // Ears, behind the shell, pulsing with the voice
    let er = K.earR + 0.05 * ear.x
    disc(-K.headW / 2, -0.02, er, clayColor); disc(K.headW / 2, -0.02, er, clayColor)
    // Antenna
    let ax = sin(ant.x) * K.stalk, ay = -K.headH / 2 - cos(ant.x) * K.stalk
    c.setStrokeColor(shellBottom.cgColor); c.setLineWidth(u(0.05)); c.setLineCap(.round)
    c.move(to: CGPoint(x: 0, y: u(-K.headH / 2 + 0.02)))
    c.addQuadCurve(to: CGPoint(x: u(ax), y: u(ay)), control: CGPoint(x: u(ax * 0.2), y: u(ay + 0.1)))
    c.strokePath()
    let g = max(0, min(1, glow.x))
    if g > 0.02 { disc(ax, ay, K.ball + 0.15 * glow.x, clayColor.withAlphaComponent(CGFloat(0.3 * g))) }
    disc(ax, ay, K.ball, clayColor)
    // Shell, lighter on top
    let shell = rrect(-K.headW / 2, -K.headH / 2, K.headW, K.headH, K.headR)
    c.saveGState()
    c.addPath(shell.cgPath); c.clip()
    if let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                             colors: [shellTop.cgColor, shellBottom.cgColor] as CFArray, locations: [0, 1]) {
      c.drawLinearGradient(grad, start: CGPoint(x: 0, y: u(-K.headH / 2)), end: CGPoint(x: 0, y: u(K.headH / 2)), options: [])
    }
    c.restoreGState()
    fill(rrect(-0.4, -0.38, 0.26, 0.07, 0.035), UIColor(white: 1, alpha: 0.55))
    // Visor and face
    fill(rrect(-K.visorW / 2, K.visorY - K.visorH / 2, K.visorW, K.visorH, K.visorR), visorColor)
    let fx = lookX.x, fy = K.visorY + lookY.x
    if happy.x > 0.5 {
      c.setStrokeColor(glowColor.cgColor); c.setLineWidth(u(0.06)); c.setLineCap(.round)
      for s in [-1.0, 1.0] {
        let p = UIBezierPath(arcCenter: CGPoint(x: u(s * K.eyeX + fx), y: u(fy + 0.04)), radius: u(0.075),
                             startAngle: .pi * 1.15, endAngle: .pi * 1.85, clockwise: true)
        c.addPath(p.cgPath); c.strokePath()
      }
    } else if think.x > 0.5 {
      for i in 0..<3 {
        let bounce = max(0, sin(clock * 7 - Double(i) * 0.9)) * 0.06
        disc(Double(i - 1) * 0.15 + fx * 0.5, fy - bounce, 0.045, glowColor)
      }
    } else {
      let eh = max(0.02, K.eyeH * blink * (1 + 0.15 * ear.x))
      for s in [-1.0, 1.0] {
        let x = s * K.eyeX + fx
        // A soft halo, then the eye: a glowing pill that blinks.
        fill(rrect(x - K.eyeW * 0.85, fy - eh * 0.85, K.eyeW * 1.7, eh * 1.7, K.eyeW * 0.85), glowColor.withAlphaComponent(0.18))
        fill(rrect(x - K.eyeW / 2, fy - eh / 2, K.eyeW, eh, K.eyeW / 2), glowColor)
      }
      if mode == .listen {
        let mw = 0.08 + 0.06 * lv, mh = 0.025 + 0.07 * lv
        fill(rrect(fx - mw / 2, fy + 0.15 - mh / 2, mw, mh, min(mw, mh) / 2), glowColor)
      }
    }
    c.restoreGState()
    // Paws on the rim while peeking
    if paws.x > 0.02 {
      let py = 0.93 - 0.1 * max(0, min(1, paws.x))
      disc(-K.pawX, py, K.pawR, shellTop); disc(K.pawX, py, K.pawR, shellTop)
    }
    // Sparkle when the words land
    if sparkle > 0 {
      c.saveGState()
      c.translateBy(x: u(0.55), y: u(-0.5)); c.rotate(by: CGFloat((1 - sparkle) * 1.5))
      c.setAlpha(CGFloat(min(1, sparkle * 2)))
      let k = u(0.14 * (0.6 + 0.4 * sin(sparkle * .pi)))
      let star = UIBezierPath()
      for i in 0..<8 {
        let a = Double(i) * .pi / 4, r = i % 2 == 1 ? k * 0.32 : k
        let p = CGPoint(x: CGFloat(cos(a)) * r, y: CGFloat(sin(a)) * r)
        if i == 0 { star.move(to: p) } else { star.addLine(to: p) }
      }
      star.close()
      fill(star, glowColor)
      c.restoreGState()
    }
    // The rim: a soft inner shadow, so the bot sits inside the window
    if let rim = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                            colors: [UIColor(red: 0, green: 0, blue: 0, alpha: 0).cgColor, UIColor(red: 0, green: 0, blue: 0, alpha: 0.42).cgColor] as CFArray,
                            locations: [0, 1]) {
      c.drawRadialGradient(rim, startCenter: .zero, startRadius: u(0.72), endCenter: .zero, endRadius: R, options: [])
    }
    c.restoreGState()
    // A glint on the glass
    c.setStrokeColor(UIColor(white: 1, alpha: 0.16).cgColor); c.setLineWidth(u(0.05)); c.setLineCap(.round)
    c.addPath(UIBezierPath(arcCenter: .zero, radius: u(0.86), startAngle: .pi * 1.08, endAngle: .pi * 1.38, clockwise: true).cgPath)
    c.strokePath()
  }

  /// CADisplayLink holds its target strongly; this holds the bot weakly.
  private final class Ticker: NSObject {
    weak var bot: PeekBotView?
    init(_ bot: PeekBotView) { self.bot = bot }
    @objc func tick(_ link: CADisplayLink) {
      if let b = bot { b.tick() } else { link.invalidate() }
    }
  }
}
