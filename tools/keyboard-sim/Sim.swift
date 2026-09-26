// Touch delivery, the typist, and the scoring.
import Foundation

// MARK: - Deterministic randomness

struct RNG {
  var s: UInt64
  init(_ seed: UInt64) { s = seed &* 0x9E3779B97F4A7C15 | 1 }
  mutating func next() -> UInt64 { s ^= s << 13; s ^= s >> 7; s ^= s << 17; return s }
  mutating func uniform() -> Double { Double(next() >> 11) / Double(1 << 53) }
  mutating func normal(_ mu: Double = 0, _ sd: Double = 1) -> Double {
    let u1 = max(uniform(), 1e-12), u2 = uniform()
    return mu + sd * sqrt(-2 * log(u1)) * cos(2 * .pi * u2)
  }
}

// MARK: - UIKit touch delivery

/// Delivers touches the way UIKit does: the window hit-tests once at
/// touch-down and that view owns the touch until it ends. A control gets
/// touchDown, then touchUpInside within 70pt of its bounds or touchUpOutside
/// beyond; a view without multi-touch takes one finger at a time. The space
/// bar carries its long-press (the trackpad): 300ms held within 10pt, and the
/// recognizer takes the touch, which cancels it on the button.
final class Dispatcher {
  let r: SDUIRenderer
  let m: Mounted
  var stats = (dead: 0, ignored: 0, touches: 0)
  private final class Live {
    let touch: UITouch; let view: UIView?; let start: CGPoint
    var cancelled = false; var trackpad = false; var lp: Timer?
    init(_ t: UITouch, _ v: UIView?, _ s: CGPoint) { touch = t; view = v; start = s }
  }
  private var live: [Int: Live] = [:]
  private var owner: [ObjectIdentifier: Int] = [:]

  init(_ r: SDUIRenderer, _ m: Mounted) { self.r = r; self.m = m }

  private func event(_ l: Live) -> UIEvent {
    let e = UIEvent()
    if let v = l.view { e.byView[ObjectIdentifier(v)] = [l.touch] }
    return e
  }

  func down(_ id: Int, _ p: CGPoint) {
    stats.touches += 1
    let t = UITouch(at: p)
    var v = m.window.hitTest(p, with: nil)
    if let vv = v, !vv.isMultipleTouchEnabled, owner[ObjectIdentifier(vv)] != nil {
      v = nil; stats.ignored += 1
    }
    let l = Live(t, v, p)
    live[id] = l
    guard let v = v else { stats.dead += 1; return }
    if !v.isMultipleTouchEnabled { owner[ObjectIdentifier(v)] = id }
    if let c = v as? UIControl {
      if c.isEnabled { c.dispatch(.touchDown, event(l)) }
      if c === m.named["space"], r.flagBool("kb.trackpad.enabled", true) {
        let timer = Timer(timeInterval: r.flagDouble("kb.trackpad.longPressMs", 300) / 1000, repeats: false) {
          [weak self, weak l] _ in
          guard let self = self, let l = l, !l.cancelled else { return }
          // .began: the trackpad takes over and the button's touch is cancelled.
          self.r.state.trackpadActive = true
          l.trackpad = true
          l.cancelled = true
          c.dispatch(.touchCancel, self.event(l))
        }
        RunLoop.main.add(timer, forMode: .common)
        l.lp = timer
      }
    } else {
      v.touchesBegan([t], with: event(l))
    }
  }

  func move(_ id: Int, _ p: CGPoint) {
    guard let l = live[id] else { return }
    l.touch.windowPoint = p
    guard let v = l.view, !l.cancelled else { return }
    if v is UIControl {
      if let lp = l.lp, hypot(p.x - l.start.x, p.y - l.start.y) > 10 { lp.invalidate(); l.lp = nil }
    } else {
      v.touchesMoved([l.touch], with: event(l))
    }
  }

  func up(_ id: Int, _ p: CGPoint) {
    guard let l = live.removeValue(forKey: id) else { return }
    l.touch.windowPoint = p
    l.lp?.invalidate()
    guard let v = l.view else { return }
    if owner[ObjectIdentifier(v)] == id { owner[ObjectIdentifier(v)] = nil }
    if l.trackpad {
      // .ended on the recognizer.
      r.state.trackpadActive = false
      r._lastSpaceTapTime = 0
      return
    }
    if l.cancelled { return }
    if let c = v as? UIControl {
      let inside = c.bounds.insetBy(dx: -70, dy: -70).contains(l.touch.location(in: c))
      c.dispatch(inside ? .touchUpInside : .touchUpOutside, event(l))
    } else {
      v.touchesEnded([l.touch], with: event(l))
    }
  }

  /// iOS taking a touch back (a system gesture).
  func cancel(_ id: Int) {
    guard let l = live.removeValue(forKey: id) else { return }
    l.lp?.invalidate()
    guard let v = l.view else { return }
    if owner[ObjectIdentifier(v)] == id { owner[ObjectIdentifier(v)] = nil }
    if l.cancelled { return }
    if let c = v as? UIControl { c.dispatch(.touchCancel, event(l)) }
    else { v.touchesCancelled([l.touch], with: event(l)) }
  }
}

// MARK: - A session: one keyboard, a stream of touches

enum TouchEv { case down(CGPoint), move(CGPoint), up(CGPoint), cancel }
struct TimedEv { let t: Double; let id: Int; let seq: Int; let ev: TouchEv }

final class Session {
  let r = SDUIRenderer()
  let m: Mounted
  let d: Dispatcher
  var proxy: FakeProxy { r.host!.hostTextDocumentProxy }
  init() {
    Clock.now = 0
    RunLoop.main.pending.removeAll()
    KeyboardTelemetry.counts = [:]
    m = r.simMount()
    d = Dispatcher(r, m)
  }
  /// Play events in time order. Between events: due timers, then the frame
  /// boundary (layout and display passes), as the run loop does.
  func play(_ evs: [TimedEv]) {
    for e in evs.sorted(by: { ($0.t, $0.seq) < ($1.t, $1.seq) }) {
      RunLoop.main.run(until: e.t)
      if e.t > Clock.now { Clock.now = e.t }
      switch e.ev {
      case .down(let p): d.down(e.id, p)
      case .move(let p): d.move(e.id, p)
      case .up(let p): d.up(e.id, p)
      case .cancel: d.cancel(e.id)
      }
      m.window.layoutIfNeeded()
      m.window.displayIfNeeded()
    }
    RunLoop.main.run(until: Clock.now + 2)
  }
  func center(_ label: String) -> CGRect {
    let b: UIButton = label == " " ? m.named["space"]! : label == "\n" ? m.named["return"]! : (m.byChar[label] ?? m.named[label]!)
    return m.window.convert(b.bounds, from: b)
  }
}

// MARK: - The typist

struct Press {
  let intended: String      // the character meant
  let target: CGPoint
  let down: Double, up: Double
  let downPt: CGPoint, upPt: CGPoint
  var cancelled = false
}

struct Typist {
  var wpm: Double
  var aimSD: (x: Double, y: Double) = (2.5, 2.5)
  var aimBiasY: Double = 0
  var clampInKey = true      // mechanics runs: every touch lands on its key
  var rollProb = 0.12        // fraction of lifts that roll toward the next key
  var holdMean = 0.085, holdSD = 0.02
  var cancelProb = 0.0       // chance iOS cancels a tap (system gesture)

  /// Two thumbs. Each key belongs to the thumb on its side; space goes to
  /// whichever thumb did NOT type the letter before it, as fast typists do.
  /// Alternating-thumb transitions are quicker than same-thumb ones, and a
  /// thumb cannot press again before it has lifted and travelled.
  func plan(_ text: String, on s: Session, rng: inout RNG) -> [Press] {
    let base = 60.0 / (wpm * 5)
    var out: [Press] = []
    var t = 0.2
    var lastThumb = 1
    var lastUp = [0.0, 0.0]
    let chars = text.map(String.init)
    for (i, c) in chars.enumerated() {
      let rect = s.center(c)
      var thumb = rect.midX < KB_WIDTH / 2 ? 0 : 1
      if c == " " { thumb = 1 - lastThumb }
      var target = CGPoint(x: rect.midX, y: rect.midY)
      if c == " " { target.x = rect.minX + rect.width * (thumb == 0 ? 0.32 : 0.68) }
      let alt = thumb != lastThumb
      let sd = 0.3
      let jitter = exp(rng.normal(-sd * sd / 2, sd))
      let gap = i == 0 ? 0 : base * (alt ? 0.75 : 1.25) * jitter
      var down = t + gap
      down = max(down, lastUp[thumb] + 0.03)
      let hold = min(0.16, max(0.045, rng.normal(holdMean, holdSD)))
      var dp = CGPoint(x: target.x + rng.normal(0, aimSD.x), y: target.y + aimBiasY + rng.normal(0, aimSD.y))
      if clampInKey {
        let k = rect.insetBy(dx: 4, dy: 4)
        dp = CGPoint(x: min(max(dp.x, k.minX), k.maxX), y: min(max(dp.y, k.minY), k.maxY))
      }
      var upPt = CGPoint(x: dp.x + rng.normal(0, 1.2), y: dp.y + rng.normal(0, 1.2))
      if rng.uniform() < rollProb, i + 1 < chars.count {
        let nr = s.center(chars[i + 1])
        let dx = nr.midX - dp.x, dy = nr.midY - dp.y
        let len = max(1, hypot(dx, dy))
        let roll = 4 + rng.uniform() * 6
        upPt.x += dx / len * roll; upPt.y += dy / len * roll
      }
      var p = Press(intended: c, target: target, down: down, up: down + hold, downPt: dp, upPt: upPt)
      if cancelProb > 0, rng.uniform() < cancelProb { p.cancelled = true }
      out.append(p)
      t = down
      lastThumb = thumb
      lastUp[thumb] = down + hold
    }
    return out
  }
}

func events(_ presses: [Press]) -> [TimedEv] {
  var evs: [TimedEv] = []
  var seq = 0
  for (id, p) in presses.enumerated() {
    evs.append(TimedEv(t: p.down, id: id, seq: seq, ev: .down(p.downPt))); seq += 1
    var t = p.down + 0.008
    while t < p.up {
      let u = (t - p.down) / (p.up - p.down)
      evs.append(TimedEv(t: t, id: id, seq: seq, ev: .move(CGPoint(
        x: p.downPt.x + (p.upPt.x - p.downPt.x) * u, y: p.downPt.y + (p.upPt.y - p.downPt.y) * u))))
      seq += 1
      t += 0.008
    }
    evs.append(TimedEv(t: p.up, id: id, seq: seq, ev: p.cancelled ? .cancel : .up(p.upPt))); seq += 1
  }
  return evs
}

// MARK: - What a perfect keyboard would have typed

/// The key whose painted rect is nearest the finger at touch-down, among
/// every key on the board. A perfect keyboard types exactly that, in press
/// order; anything else the real one does is the keyboard's doing, not the
/// aim's.
func nearestKey(_ p: CGPoint, _ s: Session) -> String {
  var best = ("", CGFloat.greatestFiniteMagnitude)
  for (label, b) in s.m.allKeys {
    let r = s.m.window.convert(b.bounds, from: b)
    let dx = max(0, max(r.minX - p.x, p.x - r.maxX)), dy = max(0, max(r.minY - p.y, p.y - r.maxY))
    let d = hypot(dx, dy)
    if d < best.1 { best = (label, d) }
  }
  return best.0
}

func idealText(_ presses: [Press], _ s: Session) -> String {
  presses.map { p -> String in
    if p.cancelled { return p.intended }   // a rescued tap should still type
    let k = nearestKey(p.downPt, s)
    return k.count == 1 || k == "\n" ? k : ""
  }.joined()
}

// MARK: - Scoring

func levenshtein(_ a: [Character], _ b: [Character]) -> Int {
  if a.isEmpty { return b.count }
  if b.isEmpty { return a.count }
  var prev = Array(0...b.count), cur = [Int](repeating: 0, count: b.count + 1)
  for i in 1...a.count {
    cur[0] = i
    for j in 1...b.count {
      cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
    }
    swap(&prev, &cur)
  }
  return prev[b.count]
}

/// Classify how `got` differs from `want`: an adjacent pair swapped, a
/// character missing, one extra, one replaced.
func classify(_ want: String, _ got: String) -> (swaps: Int, spaceSwaps: Int, drops: Int, extras: Int, subs: Int) {
  let a = Array(want), b = Array(got)
  var i = 0, j = 0
  var r = (swaps: 0, spaceSwaps: 0, drops: 0, extras: 0, subs: 0)
  while i < a.count || j < b.count {
    if i < a.count, j < b.count, a[i] == b[j] { i += 1; j += 1; continue }
    if i + 1 < a.count, j + 1 < b.count, a[i] == b[j + 1], a[i + 1] == b[j] {
      r.swaps += 1
      if a[i] == " " || a[i + 1] == " " { r.spaceSwaps += 1 }
      i += 2; j += 2; continue
    }
    // Which single edit re-synchronises the rest best?
    let restDrop = i + 1 <= a.count ? levenshtein(Array(a[min(i + 1, a.count)...].prefix(12)), Array(b[j...].prefix(12))) : 99
    let restExtra = j + 1 <= b.count ? levenshtein(Array(a[i...].prefix(12)), Array(b[min(j + 1, b.count)...].prefix(12))) : 99
    let restSub = (i < a.count && j < b.count) ? levenshtein(Array(a[(i + 1)...].prefix(12)), Array(b[(j + 1)...].prefix(12))) : 99
    if i < a.count, restDrop <= restExtra, restDrop <= restSub { r.drops += 1; i += 1 }
    else if j < b.count, restExtra <= restSub { r.extras += 1; j += 1 }
    else { r.subs += 1; i += 1; j += 1 }
  }
  return r
}

/// Finger-down to character-on-screen, per press, matched in order against
/// the arrivals the host recorded.
func latencies(_ presses: [Press], _ proxy: FakeProxy) -> [(char: String, ms: Double)] {
  var inserts: [(t: Double, ch: Character)] = []
  var prev = ""
  for a in proxy.arrivals {
    if a.text.count > prev.count, a.text.hasPrefix(prev) {
      for ch in a.text.dropFirst(prev.count) { inserts.append((a.t, ch)) }
    }
    prev = a.text
  }
  var used = [Bool](repeating: false, count: inserts.count)
  var out: [(String, Double)] = []
  for p in presses {
    guard let ch = p.intended.first else { continue }
    if let k = inserts.indices.first(where: { !used[$0] && inserts[$0].ch == ch && inserts[$0].t >= p.down - 1e-9 }) {
      used[k] = true
      out.append((p.intended, (inserts[k].t - p.down) * 1000))
    }
  }
  return out
}

func percentile(_ xs: [Double], _ q: Double) -> Double {
  guard !xs.isEmpty else { return .nan }
  let s = xs.sorted()
  return s[min(s.count - 1, Int(Double(s.count - 1) * q + 0.5))]
}
