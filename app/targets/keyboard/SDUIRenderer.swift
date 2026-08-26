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
// v2: accent long-press trays ARE routed through the plane now (per-track hold
// timer → renderer presents the tray, finger slides to a chip, release commits)
// so the plane no longer costs the accent feature. Rolling, multi-touch,
// slide-cancel, press feedback, press-order rollover and LM-biased targeting
// all live here.
final class KeyPlaneView: UIView {
  /// What a plane-managed key does. Characters commit text; shift and
  /// layer-switch keys are plane-managed too (K7) so a finger can go DOWN on
  /// them and SLIDE onto a character — the two native gestures (shift→letter
  /// one-shot capital, 123→symbol layer-peek) that per-button touch handling
  /// can never express.
  enum Role {
    case character(String)
    case shift
    case layerSwitch(target: String?)
  }
  struct Key { weak var button: UIButton?; let role: Role }

  /// The plane is PERSISTENT across remounts (K7): rebind() swaps the key set
  /// while live touches keep flowing — that's what lets a layer-peek remount
  /// happen mid-touch and the same finger continue onto the new layer's keys.
  private var keys: [Key] = []
  private weak var renderer: SDUIRenderer?

  /// kb.keyPlane.rolloverCommit — commit an already-held key the moment a NEW
  /// finger touches down, so overlapped two-thumb presses emit in PRESS order.
  /// Committing at each finger's own lift (the v1 behavior) inverted pairs when
  /// the first key was released after the second was pressed ("teh" for "the"),
  /// which is exactly how fast typists overlap. Matches the system keyboard.
  var rolloverCommit = true
  /// kb.keyPlane.accentTrays — long-press accent trays routed through the plane.
  var accentTraysEnabled = true
  /// kb.accentTray.longPressMs — hold threshold before the tray opens.
  var trayLongPressMs: Double = 500
  /// kb.touch.lmBias.pt — extra points of gap a "likely next letter" may claim
  /// (0 = language-model bias off). Only ever shifts AMBIGUOUS touches (gap /
  /// slop zone); a touch landing inside a key's real bounds is never stolen.
  var lmBiasPt: CGFloat = 0
  /// kb.touch.vSlop — vertical reach of every key beyond its rect. The 10pt
  /// row gaps are fully covered from both sides; nearest-row scoring (see
  /// keyAt) decides the winner.
  var vSlop: CGFloat = 8
  /// kb.touch.topRowUpSlop — extra upward reach for the TOP letter row, so a
  /// touch that overshoots q..p toward the toolbar still types. Real toolbar
  /// controls (mic, tone pill, suggestion chips) are obstacle-vetoed.
  var topRowUpSlop: CGFloat = 12
  /// kb.touch.bottomRowDownSlop — extra downward reach for the BOTTOM letter
  /// row toward the space row; the space/return/123 keys themselves are
  /// obstacle-vetoed so only the true gap is claimed.
  var bottomRowDownSlop: CGFloat = 10
  /// kb.touch.edgeToMargin — each row's outermost key owns its side margin
  /// all the way to the keyboard edge (the dead corners beside "a" and "l"
  /// on the indented middle row — native types the edge letter there).
  var edgeToMargin = true
  /// kb.shift.longPressMs — hold-to-caps-lock threshold for the plane-managed
  /// shift key (its old gesture recognizer is dead once the plane owns it).
  var shiftLongPressMs: Double = 350
  /// kb.swipe.enabled — QuickPath-style glide typing. Engages when a single
  /// finger traverses ≥ swipeMinKeys distinct character keys.
  var swipeEnabled = false
  /// kb.swipe.minKeys — distinct keys a drag must cross before it reads as a
  /// swipe instead of a roll.
  var swipeMinKeys = 3
  /// kb.swipe.trail.* — the fading ink trail behind a swipe.
  var trailColor: UIColor = UIColor(white: 1, alpha: 0.85)
  var trailWidth: CGFloat = 7
  var trailFadeMs: Double = 260
  /// kb.touch.holdMultiplier — how far a finger may drift off the pressed key
  /// before the press is CANCELLED, as a multiple of the key's own size.
  /// Native keeps a key held through a lot of drift; only a deliberate slide
  /// cancels. Lower = twitchier, higher = stickier. 0 restores the old
  /// no-hysteresis behavior (any drift onto dead space drops the keystroke).
  var holdMultiplier: CGFloat = 1.0
  /// kb.touch.cancelCommit.* — iOS CANCELS touches its system gesture
  /// recognizer claims, and the home-indicator band overlaps the bottom row,
  /// so quick light taps there get cancelled rather than ended. A cancelled
  /// touch this short and this still is treated as a real tap and commits.
  /// Set maxMs to 0 to stop rescuing cancelled taps entirely.
  var cancelCommitMaxMs: Double = 300
  var cancelCommitMaxDrift: CGFloat = 12

  /// Live, enabled controls elsewhere in the tree (shift / delete / space /
  /// return / mic / tone / suggestion chips). Their rects VETO plane
  /// ownership: a point inside one is never claimed for a letter, which is
  /// what makes the generous slops above safe.
  private struct WeakView { weak var v: UIView? }
  private var obstacles: [WeakView] = []
  private var obstacleRects: [CGRect] = []
  func setObstacles(_ views: [UIView]) {
    obstacles = views.map { WeakView(v: $0) }
    refreshObstacleRects()
  }
  private func refreshObstacleRects() {
    var out: [CGRect] = []
    for w in obstacles {
      guard let v = w.v, v.window != nil, !v.isHidden, v.alpha > 0.01 else { continue }
      var r = convert(v.bounds, from: v)
      // Veto the control's EXPANDED touch target, not just its painted rect —
      // special keys are KeyHitButtons with hit slop (y=8/x=2), and a tap in
      // that slop band must reach them, not be claimed for a nearby letter by
      // the edge/vertical reach above.
      if let k = v as? KeyHitButton {
        r = r.inset(by: UIEdgeInsets(
          top: -k.hitSlop.top, left: -k.hitSlop.left,
          bottom: -k.hitSlop.bottom, right: -k.hitSlop.right))
      }
      if r.width > 0, r.height > 0 { out.append(r) }
    }
    obstacleRects = out
  }

  /// Per-active-touch state: the key currently under that finger.
  private final class Track {
    weak var button: UIButton?
    var char: String?
    /// Set once the char has been committed early by press-order rollover —
    /// the touch stays tracked (for hasActiveTouches) but must not commit or
    /// re-target again.
    var committed = false
    /// Where the touch started, for the hold-vs-roll accent-tray decision.
    var startPoint: CGPoint = .zero
    /// When the touch started — lets touchesCancelled tell a quick tap the
    /// system gesture recognizer stole (commit it) from a real swipe (drop it).
    let downAt = CACurrentMediaTime()
    /// Pending accent-tray / shift-hold timer; invalidated on roll/lift/commit.
    var trayTimer: Timer?
    /// True while this finger is driving an open accent tray.
    var trayActive = false
    /// Non-nil when this touch began on shift or a layer-switch key.
    var specialRole: Role?
    /// True while this track owes a planeUp (a planeDown was delivered and
    /// not yet balanced). Balanced by identity-independent bookkeeping: after
    /// a layer-peek remount the pressed button is deallocated (weak → nil),
    /// and skipping the balance leaked planeActiveTouchCount +1 per peek —
    /// killing key-pop callouts for the rest of the session.
    var pressed = false
    /// The layout to return to after a layer-peek commit (nil = plain tap,
    /// stay on the switched layer).
    var peekReturn: String?
    /// True once this touch has been promoted to a QuickPath swipe.
    var swipeMode = false
    /// The ordered distinct character keys the swipe has crossed.
    var sweptChars: [String] = []
    /// Sampled path points (plane coords) for the trail + decode geometry.
    var pathPoints: [CGPoint] = []
    init(_ b: UIButton?, _ c: String?) { button = b; char = c }
    deinit { trayTimer?.invalidate() }
  }
  private var tracks: [ObjectIdentifier: Track] = [:]

  /// True while any finger is down on the plane. The renderer defers config
  /// remounts on this — swapping the tree mid-touch dropped the keystroke.
  var hasActiveTouches: Bool { !tracks.isEmpty }

  /// Key frames in this view's coordinate space, refreshed on layout.
  /// `rect` is the key's real frame; `own` is its OWNERSHIP box — rect grown
  /// by the row-aware slops and (for a row's outermost keys) out to the
  /// keyboard edge. A touch must land inside `own` to be a candidate; the
  /// nearest `rect` (both axes) then wins.
  private var frames: [(button: UIButton, char: String, rect: CGRect, own: CGRect)] = []
  /// Shift / layer-switch key frames — separate from the character grid:
  /// they're touch-DOWN anchors (a finger can begin here and slide onto a
  /// character), never roll targets.
  private var roleFrames: [(button: UIButton, role: Role, rect: CGRect)] = []
  /// The swipe ink trail.
  private let trailLayer = CAShapeLayer()
  /// Union of every key's ownership box — the region where a tap must ALWAYS
  /// resolve to a key rather than falling through to nothing.
  private var gridBand: CGRect = .zero
  /// kb.touch.fillGaps — claim every point inside the letter grid for its
  /// nearest key. Off restores the old behaviour where a point outside every
  /// ownership box was simply dropped.
  var fillGaps = true

  init(renderer: SDUIRenderer) {
    self.renderer = renderer
    super.init(frame: .zero)
    isMultipleTouchEnabled = true
    isUserInteractionEnabled = true
    backgroundColor = .clear
    isOpaque = false
    trailLayer.fillColor = nil
    trailLayer.lineCap = .round
    trailLayer.lineJoin = .round
    layer.addSublayer(trailLayer)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

  /// Swap the key set after a remount. Live touches keep their Track state —
  /// stale weak buttons resolve to nil and re-target against the fresh
  /// geometry on the next move (this is what layer-peek rides on).
  func rebind(keys: [Key]) {
    self.keys = keys
    frames = []
    roleFrames = []
    refreshFrames()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    refreshFrames()
  }

  private func refreshFrames() {
    var raw: [(UIButton, String, CGRect)] = []
    var roles: [(UIButton, Role, CGRect)] = []
    for k in keys {
      guard let b = k.button, b.window != nil else { continue }
      let r = convert(b.bounds, from: b)
      if r.width <= 0 || r.height <= 0 { continue }
      switch k.role {
      case .character(let ch): raw.append((b, ch, r))
      case .shift, .layerSwitch: roles.append((b, k.role, r))
      }
    }
    roleFrames = roles
    // Cluster keys into rows by vertical center (rows sit ~54pt apart; 8pt
    // tolerance absorbs any per-key constraint rounding).
    var rowYs: [CGFloat] = []
    for (_, _, r) in raw where !rowYs.contains(where: { abs($0 - r.midY) < 8 }) {
      rowYs.append(r.midY)
    }
    rowYs.sort()
    func rowIndex(_ r: CGRect) -> Int {
      rowYs.firstIndex(where: { abs($0 - r.midY) < 8 }) ?? 0
    }
    // Per-row horizontal extremes → which keys are the row's outermost.
    var minXByRow: [Int: CGFloat] = [:], maxXByRow: [Int: CGFloat] = [:]
    for (_, _, r) in raw {
      let i = rowIndex(r)
      minXByRow[i] = min(minXByRow[i] ?? r.minX, r.minX)
      maxXByRow[i] = max(maxXByRow[i] ?? r.maxX, r.maxX)
    }
    let lastRow = rowYs.count - 1
    var out: [(UIButton, String, CGRect, CGRect)] = []
    for (b, ch, r) in raw {
      let i = rowIndex(r)
      let up = i == 0 ? topRowUpSlop : vSlop
      let down = i == lastRow ? bottomRowDownSlop : vSlop
      let sideReach = r.width / 2 + 6
      var left = r.minX - sideReach
      var right = r.maxX + sideReach
      if edgeToMargin {
        if r.minX <= (minXByRow[i] ?? r.minX) + 0.5 { left = bounds.minX }
        if r.maxX >= (maxXByRow[i] ?? r.maxX) - 0.5 { right = bounds.maxX }
      }
      let own = CGRect(x: left, y: r.minY - up,
                       width: right - left, height: r.height + up + down)
      out.append((b, ch, r, own))
    }
    frames = out
    // The letter grid's outer band, including the row slops. Everything inside
    // this belongs to SOME key (see keyAt's nearest-key fallback); everything
    // outside is the tools row or the bottom row and must stay unclaimed.
    if let first = out.first {
      var band = first.3
      for f in out { band = band.union(f.3) }
      gridBand = band
    } else {
      gridBand = .zero
    }
    refreshObstacleRects()
  }

  /// The character key nearest `point`, but only when `point` genuinely lands
  /// on the character grid (same row band + within a half-key horizontal
  /// reach). Returns nil for the special-key columns and other rows so those
  /// touches fall through to the controls beneath.
  private func keyAt(_ point: CGPoint) -> (button: UIButton, char: String)? {
    if frames.isEmpty { refreshFrames() }
    // A point inside a REAL control (delete / space / return / mic / tone /
    // suggestion chip) is never a character's — it falls through to that
    // control. Same for the plane-managed shift/layer keys: they're role
    // anchors, and the letter rows' edge-to-margin reach must not swallow
    // them. This veto is what lets the ownership boxes be generous.
    for o in obstacleRects where o.contains(point) { return nil }
    if roleKeyAt(point) != nil { return nil }
    // Language-model bias: the set of letters likely to follow the last typed
    // character (backend bigram table). A likely key's score for an AMBIGUOUS
    // touch shrinks by lmBiasPt — the cheap version of the system keyboard's
    // dynamic hit-target resizing. Direct in-bounds hits score 0 and always
    // win (see the max(0.01, …) clamp).
    let likely: Set<String> = lmBiasPt > 0 ? (renderer?.lmLikelyNext() ?? []) : []
    var best: (button: UIButton, char: String, score: CGFloat)?
    for f in frames {
      guard f.own.contains(point) else { continue }
      // Distance from the point to the key's REAL rect, both axes (0 inside).
      // Scoring dx+dy makes a touch in the vertical row gap resolve to the
      // NEAREST row — the old single-axis check resolved between-row touches
      // by iteration order, i.e. arbitrarily.
      let dx = max(0, max(f.rect.minX - point.x, point.x - f.rect.maxX))
      let dy = max(0, max(f.rect.minY - point.y, point.y - f.rect.maxY))
      var score = dx + dy
      if score > 0, !likely.isEmpty, likely.contains(f.char) {
        score = max(0.01, score - lmBiasPt)
      }
      if best == nil || score < best!.score { best = (f.button, f.char, score) }
    }
    if let b = best { return (b.button, b.char) }

    // NO ownership box claimed the point. Native has no such holes — every
    // pixel of the letter grid belongs to a key — but ours dropped the tap
    // entirely, which is the "tapping between keys does nothing" dead zone.
    // Inside the grid band, fall back to the plainly nearest key. Outside it
    // we still return nil: that's the tools row or the bottom row, and their
    // own controls must keep receiving those touches.
    guard fillGaps, gridBand.contains(point) else { return nil }
    var nearest: (button: UIButton, char: String, d: CGFloat)?
    for f in frames {
      let dx = max(0, max(f.rect.minX - point.x, point.x - f.rect.maxX))
      let dy = max(0, max(f.rect.minY - point.y, point.y - f.rect.maxY))
      let d = dx + dy
      if nearest == nil || d < nearest!.d { nearest = (f.button, f.char, d) }
    }
    guard let n = nearest else { return nil }
    return (n.button, n.char)
  }

  /// The shift / layer key whose rect (+ its OWN hit slop) contains the
  /// point — NEAREST wins when slop bands overlap (shift and "123" sit in
  /// adjacent rows; first-match order made shift swallow taps aimed at 123).
  private func roleKeyAt(_ point: CGPoint) -> (button: UIButton, role: Role)? {
    var best: (button: UIButton, role: Role, dist: CGFloat)?
    for f in roleFrames {
      let slop = (f.button as? KeyHitButton)?.hitSlop
        ?? UIEdgeInsets(top: 8, left: 2, bottom: 8, right: 2)
      let expanded = f.rect.inset(by: UIEdgeInsets(
        top: -slop.top, left: -slop.left, bottom: -slop.bottom, right: -slop.right))
      guard expanded.contains(point) else { continue }
      let dx = max(0, max(f.rect.minX - point.x, point.x - f.rect.maxX))
      let dy = max(0, max(f.rect.minY - point.y, point.y - f.rect.maxY))
      let d = dx + dy
      if best == nil || d < best!.dist { best = (f.button, f.role, d) }
    }
    return best.map { ($0.button, $0.role) }
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    // Refresh geometry BEFORE deciding ownership — touchesBegan re-derives it
    // anyway, and deciding here on stale frames/obstacles (e.g. suggestion
    // chips that appeared since the last layout) would claim a touch that
    // keyAt then refuses, silently swallowing it.
    refreshFrames()
    // Own the character grid + the plane-managed shift/layer keys; else nil
    // so delete / space / return / mic below receive the touch normally.
    return (keyAt(point) != nil || roleKeyAt(point) != nil) ? self : nil
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
    // Press-order rollover: a NEW finger down commits every still-held key
    // right now, so overlapped presses land in the order they were pressed —
    // not the order the fingers happened to lift.
    flushPendingCommits()
    for t in touches {
      let p = t.location(in: self)
      // Shift / layer-switch keys first — their rects are vetoed out of
      // keyAt, so the checks are disjoint.
      if let role = roleKeyAt(p) {
        let track = Track(role.button, nil)
        track.startPoint = p
        track.specialRole = role.role
        tracks[ObjectIdentifier(t)] = track
        renderer?.planeDown(role.button)
        track.pressed = true
        switch role.role {
        case .shift:
          renderer?.planeShiftDown()
          // Hold → caps lock (the button's old gesture recognizer is dead
          // under the plane). .common mode — .default timers pause mid-touch.
          let timer = Timer(timeInterval: shiftLongPressMs / 1000.0, repeats: false) {
            [weak self, weak track] _ in
            // Still a pure hold (never slid onto a character) → caps lock.
            guard let self = self, let track = track, track.char == nil else { return }
            self.renderer?.planeShiftLongPress()
          }
          RunLoop.main.add(timer, forMode: .common)
          track.trayTimer = timer
        case .layerSwitch(let target):
          // Layer-peek: switch NOW (touch-down, like native) — the renderer
          // remounts synchronously and rebinds this persistent plane, so THIS
          // touch keeps flowing and can slide onto the new layer's keys.
          // peekReturn remembers where to bounce back to after a slide-commit;
          // a plain tap (no slide) stays on the switched layer.
          track.peekReturn = renderer?.planePeekBegan(target: target)
        case .character:
          break
        }
        continue
      }
      let hit = keyAt(p)
      let track = Track(hit?.button, hit?.char)
      track.startPoint = p
      // Seed the swipe path with the STARTING key — sweptChars otherwise only
      // gains keys on roll-off, so every swipe decoded anchored one key late
      // ("hello" swiped h→o arrived as e-l-o and matched nothing).
      if let ch = hit?.char { track.sweptChars = [ch] }
      tracks[ObjectIdentifier(t)] = track
      if let b = hit?.button { renderer?.planeDown(b); track.pressed = true }
      // Arm the accent-tray hold for this finger. Fires only if the finger is
      // still down, hasn't rolled/committed, and the key actually has accents
      // (the renderer decides that when presenting). Timer goes to .common —
      // .default-mode timers pause while a finger is on screen.
      if accentTraysEnabled, hit != nil {
        let timer = Timer(timeInterval: trayLongPressMs / 1000.0, repeats: false) {
          [weak self, weak track] _ in
          guard let self = self, let track = track,
                !track.committed, !track.trayActive, !track.swipeMode else { return }
          if self.renderer?.planeTryPresentAccentTray(for: track.button, char: track.char) == true {
            track.trayActive = true
          }
        }
        RunLoop.main.add(timer, forMode: .common)
        track.trayTimer = timer
      }
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches {
      guard let track = tracks[ObjectIdentifier(t)], !track.committed else { continue }
      let p = t.location(in: self)
      if track.trayActive {
        // The finger is driving the accent tray now — slide highlights chips;
        // no key re-targeting. Plane and mount container share identical
        // frames (both pinned to the same edges), so plane coords pass through.
        renderer?.planeUpdateAccentTray(at: p)
        continue
      }
      if track.swipeMode {
        track.pathPoints.append(p)
        if track.pathPoints.count > 128 { track.pathPoints.removeFirst(64) }
        if let ch = keyAt(p)?.char, ch != track.sweptChars.last {
          track.sweptChars.append(ch)
        }
        updateTrail(with: track.pathPoints)
        continue
      }
      // A hold that drifts is a roll, not a long-press — disarm the tray.
      if track.trayTimer != nil, hypot(p.x - track.startPoint.x, p.y - track.startPoint.y) > 12 {
        track.trayTimer?.invalidate()
        track.trayTimer = nil
      }
      let hit = keyAt(p)
      if track.button !== hit?.button {
        // NATIVE HYSTERESIS: a light, glancing touch drifts through DEAD
        // slivers — an obstacle's edge, a point past the slop bands — at
        // exactly the moment of lift, and clearing the key there dropped the
        // keystroke ("only a hard touch registers"). Like the system
        // keyboard: leaving the pressed key's zone does NOT release it; only
        // entering ANOTHER key retargets, and only a deliberate slide (a
        // full key-size beyond the pressed key's rect) cancels.
        if hit == nil,
           holdMultiplier > 0,
           let curBtn = track.button,
           let cur = frames.first(where: { $0.button === curBtn }),
           cur.rect.insetBy(dx: -cur.rect.width * holdMultiplier,
                            dy: -cur.rect.height * holdMultiplier).contains(p) {
          // Jitter, not a slide — keep the key held.
        } else {
          track.trayTimer?.invalidate()   // rolled onto another key — no tray/lock
          track.trayTimer = nil
          if track.pressed {
            // Balance the outstanding down even if the pressed button was
            // deallocated by a peek remount (weak → nil).
            if let old = track.button { renderer?.planeUp(old) } else { renderer?.planeUpLost() }
            track.pressed = false
          }
          if let nw = hit?.button { renderer?.planeDown(nw); track.pressed = true }
          track.button = hit?.button
          track.char = hit?.char
          // Record traversal for swipe promotion (character tracks only).
          if track.specialRole == nil, let ch = hit?.char, ch != track.sweptChars.last {
            track.sweptChars.append(ch)
          }
        }
      }
      if swipeEnabled {
        track.pathPoints.append(p)
        // Bounded: only the trail tail + decode use these, and a long jittery
        // hold must not grow memory inside a jetsam-capped extension.
        if track.pathPoints.count > 128 { track.pathPoints.removeFirst(64) }
      }
      // Promote to a QuickPath swipe: a single finger gliding across ≥N
      // distinct keys is a word-shape, not a roll. Roll semantics stay for
      // short drifts and for role (shift/layer) slides.
      if swipeEnabled, track.specialRole == nil, !track.swipeMode,
         tracks.values.filter({ !$0.committed }).count == 1,
         track.sweptChars.count >= swipeMinKeys,
         renderer?.planeCanSwipe() == true {
        track.swipeMode = true
        track.trayTimer?.invalidate()
        track.trayTimer = nil
        if let b = track.button { renderer?.planeUp(b) }   // no held-key visual mid-swipe
        renderer?.planeSwipeEngaged()
        updateTrail(with: track.pathPoints)
      }
    }
  }

  /// The keys the finger actually TURNED on.
  ///
  /// A swipe crosses many keys incidentally, but it changes direction at the
  /// letters that matter — that corner is the strongest signal in swipe
  /// decoding and the old decoder ignored it completely, using only the set of
  /// crossed keys. Any word whose letters appeared in order among those keys
  /// scored, so a long glide matched almost anything.
  ///
  /// Detection: walk the path with a lookaround window, measure the turn angle
  /// between the incoming and outgoing direction, and treat a sharp turn as a
  /// deliberate stop. Endpoints always count — a word starts and ends where
  /// the finger did.
  func pivotChars(_ points: [CGPoint]) -> [String] {
    guard points.count >= 2 else { return [] }
    let window = 3
    var pivotPoints: [CGPoint] = [points.first!]
    var i = window
    while i < points.count - window {
      let p = points[i]
      let a = points[i - window], b = points[i + window]
      let v1 = CGVector(dx: p.x - a.x, dy: p.y - a.y)
      let v2 = CGVector(dx: b.x - p.x, dy: b.y - p.y)
      let m1 = hypot(v1.dx, v1.dy), m2 = hypot(v2.dx, v2.dy)
      // Ignore jitter: a turn only means something if the finger actually
      // travelled far enough on both sides of it.
      if m1 > 8, m2 > 8 {
        let cosA = (v1.dx * v2.dx + v1.dy * v2.dy) / (m1 * m2)
        // ~55°+ of turn. Gentle arcs through a key are pass-throughs, not stops.
        if cosA < 0.57 {
          pivotPoints.append(p)
          i += window   // one corner, not a cluster of adjacent samples
        }
      }
      i += 1
    }
    pivotPoints.append(points.last!)

    var out: [String] = []
    for p in pivotPoints {
      guard let ch = keyAt(p)?.char else { continue }
      if ch != out.last { out.append(ch) }
    }
    return out
  }

  // MARK: - Swipe trail

  /// Invalidates a pending fade-cleanup when a NEW swipe starts within
  /// trailFadeMs of the previous one (the stale asyncAfter used to nil the
  /// fresh trail's path, and the lingering fade animation pinned opacity 0).
  private var trailGeneration = 0

  private func updateTrail(with points: [CGPoint]) {
    guard points.count > 1 else { return }
    trailGeneration += 1
    trailLayer.removeAnimation(forKey: "fade")
    let tail = points.suffix(40)
    let path = UIBezierPath()
    path.move(to: tail.first!)
    for pt in tail.dropFirst() { path.addLine(to: pt) }
    trailLayer.strokeColor = trailColor.cgColor
    trailLayer.lineWidth = trailWidth
    trailLayer.opacity = 1
    trailLayer.path = path.cgPath
  }

  private func fadeTrail() {
    trailGeneration += 1
    let gen = trailGeneration
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    fade.duration = trailFadeMs / 1000.0
    fade.fillMode = .forwards
    fade.isRemovedOnCompletion = false
    trailLayer.add(fade, forKey: "fade")
    DispatchQueue.main.asyncAfter(deadline: .now() + trailFadeMs / 1000.0) { [weak self] in
      guard let self = self, self.trailGeneration == gen else { return }
      self.trailLayer.path = nil
      self.trailLayer.removeAnimation(forKey: "fade")
      self.trailLayer.opacity = 0
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches {
      guard let track = tracks.removeValue(forKey: ObjectIdentifier(t)) else { continue }
      track.trayTimer?.invalidate()
      if track.pressed {
        if let b = track.button { renderer?.planeUp(b) } else { renderer?.planeUpLost() }
        track.pressed = false
      }
      if track.committed { continue }   // already typed by press-order rollover
      if track.swipeMode {
        fadeTrail()
        // Pivots are the shape information the old decoder threw away — see
        // pivotChars(). Without them any word whose letters merely appear in
        // order among the crossed keys matched, which is why long swipes
        // returned near-random words.
        renderer?.planeSwipeCommit(sweptChars: track.sweptChars,
                                   pivots: pivotChars(track.pathPoints))
        continue
      }
      if track.trayActive {
        let p = t.location(in: self)
        // Released on a chip → that accent; still on the key below the tray →
        // the base char (matching iOS); slid anywhere else → nothing. If the
        // tray itself was destroyed under this finger (peek remount from a
        // second touch), the held key must STILL type — lostTrayFallback.
        let stillOnKey = keyAt(p)?.char == track.char
        renderer?.planeCommitAccentTray(at: p,
                                        fallbackChar: stillOnKey ? track.char : nil,
                                        lostTrayFallback: track.char)
        continue
      }
      if let role = track.specialRole {
        switch role {
        case .shift:
          // Slid from shift onto a letter → one-shot capital commits here;
          // a plain shift tap already armed on touch-down.
          if let char = track.char { renderer?.planeCommit(char: char) }
        case .layerSwitch:
          if let char = track.char {
            // Layer-peek: press 123/#+=/ABC, slide to a key, release — the
            // key commits and the layer bounces back to where the peek began.
            renderer?.planeCommit(char: char)
            if let back = track.peekReturn { renderer?.planePeekReturn(to: back) }
          }
          // No slide → plain tap: stay on the switched layer.
        case .character:
          break
        }
        continue
      }
      // Commit the char under the finger at release. If it slid off the grid
      // (button == nil) nothing commits — native slide-to-cancel.
      if let char = track.char { renderer?.planeCommit(char: char) }
    }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    for t in touches {
      guard let track = tracks.removeValue(forKey: ObjectIdentifier(t)) else { continue }
      track.trayTimer?.invalidate()
      if track.trayActive { renderer?.planeDismissAccentTray() }
      if track.swipeMode { fadeTrail() }
      if track.pressed {
        if let b = track.button { renderer?.planeUp(b) } else { renderer?.planeUpLost() }
        track.pressed = false
      }
      // iOS CANCELS (not ends) touches its system-gesture recognizer claims,
      // and the home-indicator band overlaps the keyboard's bottom rows —
      // quick LIGHT taps there are its favorite prey. The system keyboard
      // still types those; silently dropping them read as "only hard touches
      // register". Commit when the cancelled touch was a plain short tap that
      // never really moved; a cancelled real gesture (control-center swipe)
      // has drift/duration and still dies here. No double-type risk: UIKit
      // never delivers touchesEnded for a cancelled touch.
      if cancelCommitMaxMs > 0,
         !track.committed, !track.trayActive, !track.swipeMode,
         track.specialRole == nil, let char = track.char,
         (CACurrentMediaTime() - track.downAt) * 1000 < cancelCommitMaxMs {
        let p = t.location(in: self)
        if hypot(p.x - track.startPoint.x, p.y - track.startPoint.y) < cancelCommitMaxDrift {
          // Counts how often iOS stole a real tap and we rescued it — the
          // measure of whether the K11 fix is doing anything in the field.
          KeyboardTelemetry.bump(.touchesCancelledRescued)
          renderer?.planeCommit(char: char)
        }
      }
    }
  }

  /// Commit every still-held, uncommitted letter NOW (press-order rollover).
  /// Runs when another plane touch begins, and — via the renderer — when a
  /// NON-plane key (space / return / shift / delete) goes down, so
  /// letter→special-key overlaps keep press order exactly like letter→letter.
  /// A finger driving an open accent tray is exempt: committing its base char
  /// behind the tray would type behind the user's back.
  func flushPendingCommits() {
    guard rolloverCommit else { return }
    for (_, track) in tracks
    where !track.committed && !track.trayActive && !track.swipeMode && track.specialRole == nil {
      track.trayTimer?.invalidate()
      track.trayTimer = nil
      if track.pressed {
        if let b = track.button { renderer?.planeUp(b) } else { renderer?.planeUpLost() }
        track.pressed = false
      }
      if let c = track.char { renderer?.planeCommit(char: c) }
      track.committed = true
      track.button = nil
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
  /// The current field's autocorrection trait — `.no` turns the renderer's
  /// autocorrect + suggestions off for that field (URL / email / code fields).
  func hostAutocorrectionType() -> UITextAutocorrectionType
  /// Exact text-expansion for a finished word: the user's dictionary (App
  /// Group) merged with the iOS supplementary lexicon (contact names, system
  /// text replacements). nil when no trigger matches.
  func hostExpansion(for word: String) -> String?
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
  /// WHAT the chips currently mean — they are three different things, and
  /// styling them identically misleads the user:
  ///   "revert"     — an autocorrect ALREADY landed; the chip is the word the
  ///                  user originally typed. Tapping it undoes the correction.
  ///   "alternates" — the word is spelled fine but confusable ("their"); the
  ///                  chips are other real words. None is "the" answer.
  ///   "candidates" — ranked swipe results; the first genuinely is the best.
  var suggestionKind: String = "candidates"
  /// Tone the tools-bar pill cycles through. Values chosen server-side via
  /// config.flags["kb.tones"] or the default set below when unset.
  var tone: String = "Neutral"
  /// True while space is held long enough to enter trackpad-cursor mode. When
  /// true, other keys visually dim and touch tracking on space becomes cursor
  /// movement instead of insertion.
  var trackpadActive: Bool = false
  /// Flow-session state (kb.mic.mode = "flow"): false = no background mic is
  /// armed, so the mic key shows the "Start Flow" bolt instead of the mark.
  /// Defaults true so non-flow modes never flash the bolt.
  var flowArmed: Bool = true
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
  let flowArmed: Bool

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
      appearance: s.appearance,
      flowArmed: s.flowArmed
    )
  }

  /// True when the only difference from `other` is trackpadActive. MUST be
  /// handled without a remount: the rebuild tears down the space key while
  /// its long-press gesture is mid-flight, cancelling the gesture — which is
  /// exactly the bug that made hold-space cursor movement die the instant it
  /// armed.
  func isTrackpadOnlyDelta(from other: KBStateSnapshot) -> Bool {
    shift == other.shift &&
    capsLock == other.capsLock &&
    layoutId == other.layoutId &&
    dictating == other.dictating &&
    refining == other.refining &&
    hasFullAccess == other.hasFullAccess &&
    status == other.status &&
    tone == other.tone &&
    primaryLanguage == other.primaryLanguage &&
    hasMultipleKeyboards == other.hasMultipleKeyboards &&
    appearance == other.appearance &&
    flowArmed == other.flowArmed &&
    trackpadActive != other.trackpadActive
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
    flowArmed == other.flowArmed &&
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
    // Sync state.appearance NOW — the host's traitCollectionDidChange only
    // fires on CHANGES, and on the no-cache path the renderer is created after
    // the view is already in a window, so that change already happened with no
    // renderer attached. Without this, a light-mode device kept the hardcoded
    // "dark" default and every visibleIf-gated light/dark tree variant picked
    // the wrong branch for the whole session.
    state.appearance = currentAppearance == .light ? "light" : "dark"
    syncToneFromConfig()
    // Apply theme.backgroundEffect / backgroundColor to the container itself.
    applyRootBackground(to: container)
    remount()
  }

  /// Reflect the app-side active tone (kb.personality.activeTone, a tone ID)
  /// onto the pill's display label so the keyboard opens showing the tone the
  /// user actually picked in the app.
  ///
  /// A tone picked ON THE KEYBOARD must survive this: the host refetches the
  /// config on every open (and forces updates through whenever the per-user
  /// payload differs), so unconditionally re-applying the config tone snapped
  /// the pill back to the app's tone moments after every keyboard-side pick —
  /// "tones aren't user-choosable". The baseline key records which app-side
  /// tone the pick was made AGAINST: while the config still echoes that same
  /// id (a stale echo, or our own PUT landing), the local pick wins; only a
  /// genuinely NEW app-side selection overrides it.
  private func syncToneFromConfig() {
    guard let activeId = config.flags?["kb.personality.activeTone"]?.asString else { return }
    let ud = UserDefaults(suiteName: TulmiFlow.appGroup)
    if let pick = ud?.string(forKey: "tulmi.kb.tone"), !pick.isEmpty,
       ud?.string(forKey: "tulmi.kb.tone.baseline") == activeId,
       let match = configuredTones().first(where: { $0.id == pick }) {
      state.tone = match.label
      return
    }
    if let match = configuredTones().first(where: { $0.id == activeId }) {
      state.tone = match.label
      // The app-side tone is authoritative here — refresh the mirror so the
      // refine pipeline sends the same id the pill now shows.
      ud?.set(activeId, forKey: "tulmi.kb.tone")
      ud?.set(activeId, forKey: "tulmi.kb.tone.baseline")
    }
  }

  /// The user picked a tone ON THE KEYBOARD (tap-cycle or the hold sheet).
  /// Three writes make it actually take effect:
  ///   • App Group `tulmi.kb.tone` — the picked ID; the host sends it
  ///     explicitly with every /v1/refine call so the very next refine uses
  ///     it even before the server save lands.
  ///   • App Group `tulmi.kb.tone.baseline` — the app-side activeTone the
  ///     pick was made against (see syncToneFromConfig).
  ///   • Server `PUT /v1/personality {activeTone}` (fire-and-forget partial
  ///     merge) — the app's Voice screen and future sessions agree with the
  ///     pill instead of silently reverting it.
  private func persistTonePick(id: String) {
    KeyboardTelemetry.bump(.toneChanged)
    let ud = UserDefaults(suiteName: TulmiFlow.appGroup)
    ud?.set(id, forKey: "tulmi.kb.tone")
    ud?.set(config.flags?["kb.personality.activeTone"]?.asString ?? "", forKey: "tulmi.kb.tone.baseline")
    TulmiBackend.putPersonalityQuick(body: ["activeTone": id]) { _ in }
  }

  /// Swap in a freshly-fetched config and rebuild the tree in place. This is the
  /// missing piece that let backend edits reach a LIVE keyboard: the host calls
  /// it whenever a config refetch returns, so a deploy + cache bump takes effect
  /// on the current session (after the refetch) instead of only on a future
  /// extension-process launch — which iOS schedules unpredictably. State
  /// (dictating, shift, tone…) is preserved; only the tree + theme are rebuilt.
  func updateConfig(_ newConfig: KBConfig, force: Bool = false) {
    // Short-circuit when nothing changed: the per-appearance refetch returns the
    // SAME cacheVersion most of the time, and a no-op remount still cancels any
    // in-flight key touch (silent dropped keystroke). Only rebuild on a real bump.
    // `force` bypasses this: cacheVersion only changes on deploys/admin bumps,
    // so per-USER payload changes (pinned presets, active tone, media registry
    // uploads) share a cacheVersion and were discarded wholesale — the host
    // forces the update through when the raw payload bytes actually differ.
    if !force, let old = config.cacheVersion, let new_ = newConfig.cacheVersion, old == new_ {
      return
    }
    config = newConfig
    // Flag-derived caches follow the config.
    parsedBigrams = nil
    parsedConfusables = nil
    swipeWords = nil
    cachedCheckerLang = nil
    syncToneFromConfig()
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
    // Also hold off while the space-bar trackpad is scrubbing: rebuilding the
    // tree destroys the space key mid-gesture and cancels the cursor drag.
    if (keyPlane?.hasActiveTouches == true || state.trackpadActive),
       pendingRemountRetries < 20 {
      pendingRemountRetries += 1
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
        self?.remountWhenIdle()
      }
      return
    }
    pendingRemountRetries = 0
    pendingRemount = false
    remount()
  }

  /// Tear down the current subview and rebuild from the root node. Cheap: the
  /// keyboard tree is tiny (~40 nodes).
  private func remount() {
    guard let container = mountContainer, let root = config.root else { return }
    // An open tone sheet would be buried alive by the fresh tree (it and its
    // scrim are siblings of mountedRoot): invisible, unresponsive, and leaked
    // until the next present. Close it before rebuilding. Same for an open
    // accent tray — it's also a container sibling, and the rebuilt plane has
    // empty tracks, so nothing would ever commit/dismiss it again.
    dismissToneSheet(animated: false)
    dismissAccentTray()
    mountedRoot?.removeFromSuperview()
    // NOTE: keyPlane is NOT torn down — it's persistent (K7) and rebinds to
    // the fresh tree below, so touches survive layer-peek remounts.
    // Drop any visible key-pop balloon so a mid-touch rebuild can't orphan it
    // pointing at a now-deallocated key (it's re-created lazily on next press).
    calloutView?.removeFromSuperview()
    calloutView = nil
    // Reset the fast-shift ref maps — they'll be repopulated as the fresh
    // tree renders. Keeping stale refs would leak old buttons and cause
    // the fast path to call setTitle on removed subviews.
    letterButtonsByChar.removeAll(keepingCapacity: true)
    layerKeyRegistry.removeAll(keepingCapacity: true)
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
    // to fall back to the per-button grid. Accent long-press trays are routed
    // through the plane too now (kb.keyPlane.accentTrays), so nothing is lost
    // by having it on.
    if flagBool("kb.keyPlane.enabled", true) {
      var planeKeys: [KeyPlaneView.Key] = letterButtonsByChar.compactMap { char, btn in
        guard !char.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        btn.isUserInteractionEnabled = false   // plane owns its touches now
        return KeyPlaneView.Key(button: btn, role: .character(char))
      }
      // Shift joins the plane (K7): touch-down arms it AND the same finger can
      // slide onto a letter for a native one-shot capital.
      if flagBool("kb.keyPlane.shift", true), let shift = weakShiftButton {
        shift.isUserInteractionEnabled = false
        planeKeys.append(KeyPlaneView.Key(button: shift, role: .shift))
      }
      // Layer keys join too (K7): touch-down switches instantly, and holding
      // through the switch + sliding to a key = native layer-peek.
      if flagBool("kb.layerPeek.enabled", true) {
        for entry in layerKeyRegistry {
          entry.btn.isUserInteractionEnabled = false
          planeKeys.append(KeyPlaneView.Key(button: entry.btn, role: .layerSwitch(target: entry.target)))
        }
      }
      if !planeKeys.isEmpty {
        // The new tree's constraints must be RESOLVED before the plane snaps
        // its key frames — critical on the layer-peek path, where this remount
        // runs synchronously inside an active touch.
        container.layoutIfNeeded()
        let plane = keyPlane ?? KeyPlaneView(renderer: self)
        plane.rolloverCommit = flagBool("kb.keyPlane.rolloverCommit", true)
        plane.accentTraysEnabled = flagBool("kb.keyPlane.accentTrays", true)
        plane.trayLongPressMs = flagDouble("kb.accentTray.longPressMs", 500)
        plane.lmBiasPt = flagBool("kb.touch.lmBias.enabled", false)
          ? flagCGFloat("kb.touch.lmBias.pt", 3) : 0
        plane.vSlop = flagCGFloat("kb.touch.vSlop", 8)
        plane.topRowUpSlop = flagCGFloat("kb.touch.topRowUpSlop", 12)
        plane.bottomRowDownSlop = flagCGFloat("kb.touch.bottomRowDownSlop", 10)
        plane.edgeToMargin = flagBool("kb.touch.edgeToMargin", true)
        plane.shiftLongPressMs = flagDouble("kb.shift.longPressMs", 350)
        plane.swipeEnabled = flagBool("kb.swipe.enabled", false)
        plane.swipeMinKeys = max(2, Int(flagDouble("kb.swipe.minKeys", 3)))
        plane.trailColor = flagColor("kb.swipe.trail.color", "#FFFFFFD9")
        plane.trailWidth = flagCGFloat("kb.swipe.trail.width", 7)
        plane.trailFadeMs = flagDouble("kb.swipe.trail.fadeMs", 260)
        // K11 touch feel — the values most likely to need tuning from real
        // field use, so they're OTA-adjustable rather than baked in.
        plane.fillGaps = flagBool("kb.touch.fillGaps", true)
        plane.holdMultiplier = flagCGFloat("kb.touch.holdMultiplier", 1.0)
        plane.cancelCommitMaxMs = flagDouble("kb.touch.cancelCommit.maxMs", 300)
        plane.cancelCommitMaxDrift = flagCGFloat("kb.touch.cancelCommit.maxDriftPt", 12)
        if plane.superview !== container {
          plane.translatesAutoresizingMaskIntoConstraints = false
          container.addSubview(plane)   // topmost — intercepts plane-key touches only
          NSLayoutConstraint.activate([
            plane.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            plane.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            plane.topAnchor.constraint(equalTo: container.topAnchor),
            plane.bottomAnchor.constraint(equalTo: container.bottomAnchor),
          ])
        } else {
          container.bringSubviewToFront(plane)
        }
        plane.rebind(keys: planeKeys)
        keyPlane = plane
        // Everything interactive that ISN'T plane-managed (delete, space,
        // return, mic, tone pill, suggestion chips) vetoes the plane's
        // generous reach — a touch inside any of them always goes to them.
        plane.setObstacles(collectPlaneObstacles())
      } else {
        keyPlane?.removeFromSuperview()
        keyPlane = nil
      }
    } else {
      keyPlane?.removeFromSuperview()
      keyPlane = nil
    }
    // Keep the fast-shift snapshot in sync on EVERY remount path (mount,
    // updateConfig, appearanceDidChange, stateChanged) — previously only the
    // stateChanged async block assigned it, so the first shift after any other
    // remount missed the fast path and paid a full rebuild.
    lastRenderSnapshot = KBStateSnapshot.from(state)
    // Key geometry changed → the autocorrect neighbor map must be re-derived.
    cachedNeighborMap = nil
    // Re-assert the trackpad visual: a remount that lands mid-scrub (bundled
    // state delta, exhausted deferral) rebuilds letters at alpha 1 and a fresh
    // plane with interaction ON — this restores the blanked/disabled state.
    applyTrackpadVisual(active: state.trackpadActive)
    // Build stamp — added LAST so it sits on top of the tree + plane. A small
    // corner marker that proves whether THIS binary is the one running: if iOS
    // is serving a cached old keyboard extension (the usual reason "updates do
    // nothing"), you won't see it. Bump `buildStamp` every build. Hide via
    // kb.buildStamp.enabled=false once delivery is confirmed working.
    addBuildStamp(to: container)
  }

  /// Bump this string on every build so the on-screen marker changes — that's
  /// how you tell a freshly-loaded extension from a cached old one.
  /// K4: autocorrect + suggestions, press-order rollover, LM hit-target bias,
  /// plane-side accent trays, per-keystroke XPC cuts, cold-start fast path.
  /// K5: native touch spaces — row-aware vertical slops with nearest-row
  /// scoring, edge-margin capture beside a/l, obstacle-vetoed reach — and the
  /// space-bar trackpad fixed (trackpad state changes no longer remount).
  /// K6: audit fixes — tracker-validity guards around autocorrect, hit-slop-
  /// aware obstacle veto, shift on touch-down, punctuation pull-back, layer
  /// auto-return, symbol long-press alternates, appearance/tone config sync.
  /// K7: QuickPath swipe typing (embedded lexicon + trail), persistent touch
  /// plane with role keys — instant layer switches, real layer-peek, slide-
  /// from-shift capitals — async spellcheck/completions, confusable-pair
  /// chips, backspace autocorrect revert, flow-armed mic glyph.
  /// K8: pre-submission audit fixes — newline-correction race guard, swipe
  /// first-key seeding, press-balance across peek remounts, nearest-role
  /// resolution, async remounts off button callbacks, multi-language-safe
  /// layer auto-return.
  static let buildStamp = "K25"

  /// The bundled brand mark.
  ///
  /// Looked up three ways because the one-argument form and the Bundle.main
  /// form do NOT always agree inside an app extension, and the cost of getting
  /// it wrong is Apple's own mic glyph appearing on our keyboard. Bundle(for:)
  /// is the authoritative one — it resolves against the binary this class was
  /// compiled into, whatever the host decided Bundle.main is.
  static func tailzuMark() -> UIImage? {
    if let m = UIImage(named: "TailzuMark", in: Bundle(for: SDUIRenderer.self), compatibleWith: nil) { return m }
    if let m = UIImage(named: "TailzuMark") { return m }
    return UIImage(named: "TailzuMark", in: Bundle.main, compatibleWith: nil)
  }
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
  /// Layer-switch keys ("123"/"ABC"/"#+=") registered during render so the
  /// touch plane can own them for layer-peek. `target` nil = cycle.
  private var layerKeyRegistry: [(btn: UIButton, target: String?)] = []
  private var weakShiftButton: UIButton?
  private var lastRenderSnapshot: KBStateSnapshot?

  func stateChanged() {
    let currentSnap = KBStateSnapshot.from(state)
    // Trackpad enter/exit NEVER remounts — see isTrackpadOnlyDelta. The
    // native look (blanked keys) is applied in place instead.
    if let last = lastRenderSnapshot,
       currentSnap.isTrackpadOnlyDelta(from: last) {
      applyTrackpadVisual(active: currentSnap.trackpadActive)
      lastRenderSnapshot = currentSnap
      return
    }
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
      // Route through the mid-touch guard: a state-driven rebuild (dictation
      // start/stop, status, tone…) landing while a finger is down cancels that
      // in-flight touch — a silently dropped keystroke. pendingRemount stays
      // TRUE across the guard's deferrals so later stateChanged() calls keep
      // coalescing into this one chain instead of spawning parallel retry
      // chains that each fire a full rebuild once idle; remountWhenIdle clears
      // it when it actually remounts.
      self?.remountWhenIdle()
    }
  }

  /// Native space-bar trackpad look, applied WITHOUT a remount: letters dim
  /// (native blanks them), the callout hides, and the touch plane stops
  /// claiming touches so a stray second finger can't type mid-scrub. All
  /// in-place mutations on live views — the space key and its long-press
  /// gesture survive untouched.
  private func applyTrackpadVisual(active: Bool) {
    let alpha: CGFloat = active ? 0.35 : 1
    for (_, btn) in letterButtonsByChar { btn.alpha = alpha }
    weakShiftButton?.alpha = alpha
    for entry in layerKeyRegistry { entry.btn.alpha = alpha }
    keyPlane?.isUserInteractionEnabled = !active
    if active { hideKeyCallout() }
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
  /// The tone list. Primary source is the RICH backend list the server
  /// actually ships — kb.personality.tones, [{id,label}] — so renames /
  /// reorders / additions land OTA and the App Group carries the real tone ID
  /// the app's refine pipeline expects (the old code only read the legacy
  /// "kb.tones" CSV, which the backend doesn't serve, so the pill silently
  /// cycled a client-hardcoded list). CSV + hardcoded sets remain fallbacks.
  private func configuredTones() -> [(id: String, label: String)] {
    if case .array(let arr)? = config.flags?["kb.personality.tones"] {
      let rich: [(id: String, label: String)] = arr.compactMap { item in
        guard case .object(let o) = item, let id = o["id"]?.asString, !id.isEmpty else { return nil }
        return (id, o["label"]?.asString ?? id.capitalized)
      }
      if !rich.isEmpty { return rich }
    }
    if let raw = config.flags?["kb.tones"]?.asString {
      let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
      if !parts.isEmpty { return parts.map { ($0.lowercased(), $0) } }
    }
    return [("none", "Tone"), ("casual", "Casual"), ("formal", "Formal"), ("excited", "Excited")]
  }

  // MARK: - Tone sheet (hold the tone pill → pick a voice / tone directly)

  private weak var toneSheetOverlay: UIView?
  private weak var toneSheetBlur: UIVisualEffectView?
  /// Voice picked on the keyboard this session — keeps the sheet's checkmark
  /// right before the next config refetch echoes kb.personality.activeId back.
  private var localActiveVoiceId: String?

  /// The user's keyboard voice set (kb.personality.pinned — managed from the
  /// app's Voice screen "Keyboard voices" card). Empty when nothing is pinned.
  private func pinnedKeyboardVoices() -> [(id: String, name: String, tone: String)] {
    guard case .array(let arr)? = config.flags?["kb.personality.pinned"] else { return [] }
    return arr.compactMap { item in
      guard case .object(let o) = item, let id = o["id"]?.asString, !id.isEmpty else { return nil }
      return (id, o["name"]?.asString ?? id.capitalized, o["tone"]?.asString ?? "")
    }
  }

  /// Tiny section label ("VOICES" / "TONES") for the sheet's stack.
  private func toneSheetHeader(_ text: String) -> UIView {
    let wrap = UIView()
    let l = UILabel()
    l.text = text.uppercased()
    l.font = .systemFont(ofSize: 10, weight: .bold)
    l.textColor = UIColor(white: 1, alpha: 0.4)
    l.translatesAutoresizingMaskIntoConstraints = false
    wrap.addSubview(l)
    NSLayoutConstraint.activate([
      l.leadingAnchor.constraint(equalTo: wrap.leadingAnchor, constant: 16),
      l.trailingAnchor.constraint(lessThanOrEqualTo: wrap.trailingAnchor, constant: -16),
      l.topAnchor.constraint(equalTo: wrap.topAnchor, constant: 7),
      l.bottomAnchor.constraint(equalTo: wrap.bottomAnchor, constant: -2),
    ])
    return wrap
  }

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
    // Scroll wrapper: voices + tones together can outgrow the keyboard's
    // height, and an extension can't draw past its frame — the sheet hugs its
    // content (high-priority equal-height) until the bottom clamp below stops
    // it, then the list scrolls instead of clipping rows off.
    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    scroll.showsVerticalScrollIndicator = false
    container.addSubview(scroll)
    scroll.addSubview(vstack)
    let hug = scroll.heightAnchor.constraint(equalTo: vstack.heightAnchor)
    hug.priority = .defaultHigh
    NSLayoutConstraint.activate([
      scroll.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      scroll.topAnchor.constraint(equalTo: container.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: container.bottomAnchor),
      vstack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
      vstack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
      vstack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      vstack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      vstack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
      hug,
    ])

    let accent = flagColor("kb.tone.sheet.accent", "#E8A23C")

    // Keyboard voices first (when the user has pinned any): switch the whole
    // writing voice right from the keyboard — the app's "Keyboard voices" card
    // decides what's listed here. Picking one also adopts its tone below.
    let voices = pinnedKeyboardVoices()
    if !voices.isEmpty {
      let activeVoice = localActiveVoiceId ?? config.flags?["kb.personality.activeId"]?.asString
      vstack.addArrangedSubview(toneSheetHeader("Voices"))
      for v in voices {
        let isActive = v.id == activeVoice
        let btn = UIButton(type: .system)
        btn.setTitle(isActive ? "\(v.name)  ✓" : v.name, for: .normal)
        btn.setTitleColor(isActive ? accent : .white, for: .normal)
        btn.titleLabel?.font = .systemFont(ofSize: 14, weight: isActive ? .semibold : .medium)
        btn.contentEdgeInsets = UIEdgeInsets(top: 9, left: 16, bottom: 9, right: 16)
        btn.contentHorizontalAlignment = .leading
        let pickedId = v.id, pickedTone = v.tone
        btn.addAction(UIAction { [weak self] _ in self?.selectVoice(id: pickedId, tone: pickedTone) },
                      for: .touchUpInside)
        vstack.addArrangedSubview(btn)
      }
      vstack.addArrangedSubview(toneSheetHeader("Tones"))
    }

    for tone in configuredTones() {
      let btn = UIButton(type: .system)
      let isActive = tone.label.caseInsensitiveCompare(state.tone) == .orderedSame
      btn.setTitle(isActive ? "\(tone.label)  ✓" : tone.label, for: .normal)
      btn.setTitleColor(isActive ? accent : .white, for: .normal)
      btn.titleLabel?.font = .systemFont(ofSize: 14, weight: isActive ? .semibold : .medium)
      btn.contentEdgeInsets = UIEdgeInsets(top: 9, left: 16, bottom: 9, right: 16)
      btn.contentHorizontalAlignment = .leading
      let pickedId = tone.id, pickedLabel = tone.label
      btn.addAction(UIAction { [weak self] _ in self?.selectTone(id: pickedId, label: pickedLabel) },
                    for: .touchUpInside)
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
      // Never grow past the keyboard's own frame — the scroll wrapper takes
      // over when content is taller than this allows.
      container.bottomAnchor.constraint(lessThanOrEqualTo: host.bottomAnchor, constant: -8),
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

  private func selectTone(id: String, label: String) {
    state.tone = label
    persistTonePick(id: id)
    fireKeyHaptic()
    dismissToneSheet(animated: true)
    stateChanged()   // remount → the tone pill rebinds to the new state.tone
  }

  /// A keyboard voice was picked from the sheet. Persists server-side (the
  /// active voice is what /v1/refine writes with) and adopts the voice's own
  /// tone locally, so the pill + the explicit refine tone don't keep overriding
  /// the voice with a stale earlier pick.
  private func selectVoice(id: String, tone: String) {
    KeyboardTelemetry.bump(.voiceChanged)
    localActiveVoiceId = id
    var body: [String: Any] = ["activePresetId": id]
    if !tone.isEmpty { body["activeTone"] = tone }
    TulmiBackend.putPersonalityQuick(body: body) { _ in }
    if !tone.isEmpty {
      let ud = UserDefaults(suiteName: TulmiFlow.appGroup)
      ud?.set(tone, forKey: "tulmi.kb.tone")
      ud?.set(config.flags?["kb.personality.activeTone"]?.asString ?? "", forKey: "tulmi.kb.tone.baseline")
      if let match = configuredTones().first(where: { $0.id == tone }) {
        state.tone = match.label
      }
    }
    fireKeyHaptic()
    dismissToneSheet(animated: true)
    stateChanged()
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
      // Number/symbol-layer alternates (native long-press sets). The tray
      // machinery is char-keyed, so these light up automatically on the
      // 123/#+= layers — both via the plane's hold timer and the GR path.
      "0": ["°"],
      "-": ["–", "—", "•"],
      "/": ["\\"],
      "$": ["€", "£", "¥", "₹", "¢"],
      "&": ["§"],
      "\"": ["\u{201C}", "\u{201D}", "„", "«", "»"],
      ".": ["…"],
      "?": ["¿"],
      "!": ["¡"],
      "'": ["\u{2018}", "\u{2019}", "‚", "`"],
      "%": ["‰"],
      "=": ["≠", "≈"],
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
        updateAccentTrayHighlight(at: gr.location(in: tray))
      }
    case .ended:
      pickAccentAndDismiss(gestureRecognizer: gr)
    case .cancelled, .failed:
      dismissAccentTray()
    default:
      break
    }
  }

  /// Highlight the chip under `loc` (tray-local coords); un-highlight the rest.
  private func updateAccentTrayHighlight(at loc: CGPoint) {
    guard let tray = activeAccentTray else { return }
    tray.subviews.forEach { chip in
      chip.backgroundColor = chip.frame.contains(loc)
        ? flagColor("kb.accentTray.chipActiveBg", "#007AFF")
        : keyBgColor()
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
    insertAccent(ch)
  }

  /// Insert a tray selection — shared by the gesture path and the plane path.
  private func insertAccent(_ ch: String) {
    host?.hostTextDocumentProxy.insertText(ch)
    // Same double-tap-caps chain reset as the plain insert path.
    lastShiftTapTime = 0
    if state.shift && !state.capsLock {
      state.shift = false
      stateChanged()
    }
    // Keep the tracker COHERENT rather than clearing it: wiping mid-word
    // ("caf" + "é" → tracker "") makes the next letters a strict suffix of
    // the real word — the exact desync the boundary verifier guards against.
    // The ASCII-only guard keeps autocorrect away from accented words anyway.
    lastAutocorrect = nil
    pendingAutoSpace = false
    typingGeneration += 1   // any in-flight async correction is now stale
    currentWord += ch
    refreshSuggestions()
    updateAutoCap(afterTyping: ch)
  }

  private func dismissAccentTray() {
    activeAccentTray?.removeFromSuperview()
    activeAccentTray = nil
  }

  // MARK: - Accent tray via KeyPlaneView
  //
  // With the multi-touch plane on, character buttons have userInteraction OFF,
  // so their UILongPressGestureRecognizers never fire. The plane detects the
  // hold itself (per-track timer) and drives the SAME tray through these hooks
  // — closing the "accent trays don't work while the plane is on" v1 gap.
  // Coordinates: the plane and the mount container are pinned to identical
  // edges, so plane-local points are container points.

  /// Present the tray for a held key. Returns false when the key has no
  /// accents (or the feature is off) so the plane leaves the touch as a
  /// normal press.
  fileprivate func planeTryPresentAccentTray(for button: UIButton?, char: String?) -> Bool {
    // One tray at a time: a second finger's hold must not dismiss-and-replace
    // the first finger's tray (the first finger would then commit against a
    // tray it no longer owns).
    guard activeAccentTray == nil else { return false }
    guard flagBool("kb.keyPlane.accentTrays", true),
          let button = button, let char = char,
          let accents = accentMap[char.lowercased()], !accents.isEmpty
    else { return false }
    showAccentTray(for: button, base: char, options: accents)
    guard let tray = activeAccentTray else { return false }
    // Default-highlight the base chip (iOS does this) so releasing without
    // sliding reads as "the base letter is selected".
    if let baseChip = tray.subviews.first {
      baseChip.backgroundColor = flagColor("kb.accentTray.chipActiveBg", "#007AFF")
    }
    return true
  }

  fileprivate func planeUpdateAccentTray(at point: CGPoint) {
    guard let tray = activeAccentTray, let container = mountContainer else { return }
    updateAccentTrayHighlight(at: tray.convert(point, from: container))
  }

  /// Release while a tray is open: a chip commits its accent; off-chip but
  /// still on the held key commits the base char (`fallbackChar`); anywhere
  /// else commits nothing. `lostTrayFallback` covers the tray being destroyed
  /// under the finger (peek remount from another touch): `fallbackChar` was
  /// computed against the NEW layer's geometry and may be nil, but the held
  /// key must still type.
  fileprivate func planeCommitAccentTray(at point: CGPoint, fallbackChar: String?,
                                         lostTrayFallback: String? = nil) {
    // If the tray is already gone (dismissed by a remount or another path),
    // the held key must still type its base char — losing the keystroke
    // entirely is the one unacceptable outcome.
    guard let tray = activeAccentTray, let container = mountContainer else {
      dismissAccentTray()
      if let base = lostTrayFallback ?? fallbackChar { run(.inline(.insertKey(char: base))) }
      return
    }
    defer { dismissAccentTray() }
    let loc = tray.convert(point, from: container)
    if let chip = tray.subviews.first(where: { $0.frame.contains(loc) }) as? UIButton,
       let ch = chip.title(for: .normal), !ch.isEmpty {
      insertAccent(ch)
    } else if let base = fallbackChar {
      run(.inline(.insertKey(char: base)))
    }
  }

  fileprivate func planeDismissAccentTray() { dismissAccentTray() }

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
      // The word boundary already ran on the first space; the tail is ". " —
      // a clean boundary, so tracking stays valid.
      resetTypingContext(tailAtBoundary: true)
    } else {
      proxy?.insertText(" ")
      _lastSpaceTapTime = now
      lastInsertedChar = " "   // word-start bigram row (" " entry) arms next-letter bias
      pendingAutoSpace = false
      typingGeneration += 1    // stale-guard for the async checker (symmetry with noteTyped)
      handleWordBoundary(boundary: " ")
    }
    // Native returns to the letter layer after a space typed on 123/#+=.
    autoReturnToLetters()
    updateAutoCap()
  }

  /// Space/return on the number or symbol layer flips back to the letter
  /// layer, like the system keyboard. kb.layer.returnAfterSpace kills it OTA.
  private func autoReturnToLetters() {
    guard flagBool("kb.layer.returnAfterSpace", true) else { return }
    // Only bounce back from SYMBOL layers. config.layouts is the LANGUAGE
    // list — treating layouts.first as "the letter layer" yanked a user
    // typing on any non-first language back to English on every space.
    let symbolIds = Set(flagString("kb.layer.symbolIds", "123,sym")
      .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) })
    guard symbolIds.contains(state.layoutId) else { return }
    let letters = flagString("kb.layer.lettersId", "en")
    guard (config.layouts ?? []).contains(where: { $0.language == letters }),
          state.layoutId != letters else { return }
    state.layoutId = letters
    // Async: this runs inside the space/return button's own action handler —
    // a synchronous remount would deallocate that very button (and its
    // gestures) mid-callback.
    DispatchQueue.main.async { [weak self] in self?.remount() }
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
      resetTypingContext()   // cursor is about to move — the word tracker is void
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
    // Shift arms on touch-DOWN, like the system keyboard. On touch-up (the
    // old wiring), a fast typist's shift↓·letter↓·letter↑·shift↑ overlap
    // committed the letter BEFORE shift armed — lowercase letter, and the
    // NEXT letter came out capitalized. keyTouchDown (added by makeKeyButton
    // first) flushes held plane letters before this fires, so ordering holds.
    let handler = UIAction { [weak self] _ in self?.handleShiftTap() }
    btn.addAction(handler, for: .touchDown)
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
    shiftHoldLock()
  }

  /// Hold-to-caps-lock, shared by the gesture path (plane off) and the
  /// plane's shift-hold timer.
  private func shiftHoldLock() {
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

  // MARK: - Plane role-key callbacks (shift + layer-peek, K7)

  /// Shift went down on the plane: arm/toggle exactly like a tap (the plane
  /// fires this on touch-DOWN, which is the native timing).
  fileprivate func planeShiftDown() { handleShiftTap() }

  /// Shift held on the plane → caps lock.
  fileprivate func planeShiftLongPress() { shiftHoldLock() }

  /// True only for the duration of a plane-initiated layer switch — the one
  /// caller for which run(.switchLayout)'s remount must be synchronous.
  private var planePeekInProgress = false

  /// A layer key went down: switch NOW (synchronous remount — the persistent
  /// plane rebinds and the same touch keeps working on the new layer).
  /// Returns the layout to bounce back to if this turns into a slide-commit.
  fileprivate func planePeekBegan(target: String?) -> String? {
    let origin = state.layoutId
    planePeekInProgress = true
    run(.inline(.switchLayout(language: target)))
    planePeekInProgress = false
    return origin == state.layoutId ? nil : origin
  }

  /// A layer-peek slide committed a key: bounce back to where the peek began.
  /// Called from the plane's touchesEnded — the plane survives the rebuild,
  /// so synchronous is safe here.
  fileprivate func planePeekReturn(to layout: String) {
    guard (config.layouts ?? []).contains(where: { $0.language == layout }),
          state.layoutId != layout else { return }
    state.layoutId = layout
    planePeekInProgress = true
    remount()
    planePeekInProgress = false
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

  /// Resolve a functional key's glyph from DATA rather than a compiled-in
  /// constant.
  ///
  /// Order: the node's own `props.icon` (so a tree can style one key), then a
  /// global flag (so the backend can restyle every keyboard at once), then the
  /// SF Symbol we shipped with. Accepts the full icon-spec vocabulary —
  /// { sf }, { emoji }, { url }, { asset } — so a glyph can become an emoji or
  /// a hosted image without a rebuild, which is what "backspace looks wrong in
  /// this locale" actually needs.
  private func applyKeyGlyph(_ btn: UIButton, node: KBNode, flag: String, fallbackSF: String) {
    if let spec = node.props?["icon"] ?? flagIcon(flag),
       let img = resolveIcon(spec, onLoad: { [weak self] in self?.stateChanged() }) {
      btn.setImage(img, for: .normal)
      btn.imageView?.contentMode = .scaleAspectFit
      return
    }
    btn.setImage(UIImage(systemName: fallbackSF), for: .normal)
  }

  /// Backspace — tap deletes one; long-press repeats (200ms initial then 40ms).
  private func buildBackspaceKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    applyKeyGlyph(btn, node: node, flag: "kb.icon.backspace", fallbackSF: "delete.left")
    btn.tintColor = keyTextColor()
    btn.addTarget(self, action: #selector(deleteDown), for: .touchDown)
    // .touchDragExit included: dragging off the held key must stop the
    // auto-repeat — without it the repeat kept deleting until lift.
    btn.addTarget(self, action: #selector(deleteUp),
                  for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    return btn
  }
  @objc private func deleteDown() {
    // Backspace right after an autocorrect reverts it instead of deleting —
    // and deliberately does NOT arm the repeat timer (holding through a
    // revert must not machine-gun the restored text).
    if maybeRevertAutocorrectOnDelete() {
      fireKeyHaptic()
      return
    }
    // First delete fires immediately on touch-down (Apple's pattern).
    host?.hostTextDocumentProxy.deleteBackward()
    noteDeletedBackward()
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
        self.resetTypingContext()
      } else {
        self.host?.hostTextDocumentProxy.deleteBackward()
        self.noteDeletedBackward()
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
    applyKeyGlyph(btn, node: node, flag: "kb.icon.globe", fallbackSF: "globe")
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
        let mark = SDUIRenderer.tailzuMark()
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
    } else if !state.flowArmed,
              flagBool("kb.flow.armGlyph.enabled", false),
              !["local", "stream", "handoff"].contains(flagString("kb.mic.mode", "flow").lowercased()) {
      // OFF by default (owner preference: the mic is icon-only and always the
      // brand mark). When enabled, an unarmed flow session shows the "Start
      // Flow" bolt so the arm-first tap looks different from a ready mic.
      let cfgSym = UIImage.SymbolConfiguration(
        pointSize: flagCGFloat("kb.flow.glyphSize", 16), weight: .semibold)
      btn.setImage(UIImage(systemName: flagString("kb.flow.startGlyph", "bolt.fill"),
                           withConfiguration: cfgSym), for: .normal)
      btn.imageEdgeInsets = .zero
      btn.imageView?.contentMode = .center
    } else if let mark = SDUIRenderer.tailzuMark() {
      // OWNER DECISION: the idle mic is ALWAYS the static brand mark — never
      // backend-pushed media. kb.mic.idleIcon is deliberately NOT consulted at
      // idle (it remains only the recording fallback above); an uploaded
      // animation must not replace the mark again.
      // Idle brand mark, inset so it reads as an icon centered on the circle.
      btn.setImage(mark.withRenderingMode(.alwaysTemplate), for: .normal)
      btn.imageView?.stopAnimating()
      btn.imageView?.contentMode = .scaleAspectFit
      let inset = flagCGFloat("kb.mic.idleIconInset", 8)
      btn.imageEdgeInsets = UIEdgeInsets(top: inset, left: inset, bottom: inset, right: inset)
    } else {
      // Only reachable if the brand mark is missing from the built extension —
      // i.e. the asset catalog did not compile in. Apple's mic on OUR keyboard
      // is the visible symptom of a packaging failure, so it is logged rather
      // than quietly worn.
      NSLog("[Tailzu][kb] TailzuMark missing from the bundle — showing the system mic.")
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
    applyKeyGlyph(btn, node: node, flag: "kb.icon.refine", fallbackSF: "sparkles")
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
    //   kb.suggestion.fontSize   (default 15)
    //   kb.suggestion.chipBg / .chipFg / .chipBorder / .chipBorderWidth
    //   kb.suggestion.emphasizeFirst (default true) + .leadBg / .leadFg
    let gap = flagCGFloat("kb.suggestion.gap", 8)
    let edge = flagCGFloat("kb.suggestion.edgeInset", 8)
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
    suggestionRowStack = row
    renderSuggestionChips(into: row)
    scroll.heightAnchor.constraint(equalToConstant: barHeight).isActive = true
    return scroll
  }

  /// The live suggestion row, for in-place chip refreshes from the typing
  /// pipeline (refreshSuggestions / handleWordBoundary). Chip updates must
  /// NEVER remount the tree — that would put a full rebuild on the keystroke
  /// path.
  private weak var suggestionRowStack: UIStackView?

  /// Suggestion chips.
  ///
  /// These used to be painted with keyBgColor()/keyTextColor() — the exact
  /// fill and text of a LETTER KEY — so they read as three stray keys floating
  /// in the tools row rather than as something offered to tap. They also had
  /// no font control, no border and no hierarchy, while every real key around
  /// them has deliberate sizing and a shadow.
  ///
  /// Now they're their own surface: a quieter translucent fill with a hairline
  /// edge (the app's editorial language), and the FIRST chip carries the brand
  /// accent because it's the one that will actually be applied — native's
  /// centre-slot emphasis, mapped honestly onto our ranked list. Every value
  /// is backend-tunable so the look can be adjusted without a rebuild.
  private func renderSuggestionChips(into row: UIStackView) {
    row.arrangedSubviews.forEach { $0.removeFromSuperview() }
    let chipRadius = flagCGFloat("kb.suggestion.chipRadius", 12)
    let chipPadV = flagCGFloat("kb.suggestion.chipPadV", 4)
    let chipPadH = flagCGFloat("kb.suggestion.chipPadH", 12)
    let fontSize = flagCGFloat("kb.suggestion.fontSize", 15)
    let dark = keyIsDark(keyBgColor())
    // Deliberately NOT the key fill: a suggestion is an offer, not a key.
    let chipBg = flagColor("kb.suggestion.chipBg", dark ? "#FFFFFF14" : "#00000012")
    let chipFg = flagColor("kb.suggestion.chipFg", dark ? "#FFFFFFF2" : "#000000E6")
    let borderColor = flagColor("kb.suggestion.chipBorder", dark ? "#FFFFFF24" : "#00000018")
    let borderWidth = flagCGFloat("kb.suggestion.chipBorderWidth", 1)
    // Emphasis follows MEANING, not list position. Only "candidates" (ranked
    // swipe results) have a genuine best answer worth the brand accent.
    //   • revert     — the chip is the user's OWN word after an autocorrect
    //                  landed. Painting "undo" in brand amber points the eye
    //                  at rejecting the correction, which is backwards; iOS
    //                  instead QUOTES the original, the universal "keep what
    //                  you typed" signal. We do the same.
    //   • alternates — confusable real words; none is "the" answer, so
    //                  emphasizing the first would be an arbitrary claim.
    let kind = state.suggestionKind
    let isRevert = kind == "revert"
    let leadEnabled = flagBool("kb.suggestion.emphasizeFirst", true) && kind == "candidates"
    let leadBg = flagColor("kb.suggestion.leadBg", "#E8A23C")
    let leadFg = flagColor("kb.suggestion.leadFg", "#000000")

    // The bar can also render as a plain divided row (native's three-slot
    // strip) instead of pills — kb.suggestion.style, so the whole shape is a
    // backend decision, not a compiled-in one.
    let flatStyle = flagString("kb.suggestion.style", "chips").lowercased() == "flat"
    let dividerColor = flagColor("kb.suggestion.dividerColor", dark ? "#FFFFFF24" : "#00000018")

    for (i, s) in state.suggestions.enumerated() {
      let isLead = leadEnabled && i == 0
      // A divider between slots, as the system strip has. Added BEFORE the
      // chip so it separates rather than trails.
      if flatStyle, i > 0 {
        let sep = UIView()
        sep.backgroundColor = dividerColor
        sep.translatesAutoresizingMaskIntoConstraints = false
        sep.widthAnchor.constraint(equalToConstant: 1).isActive = true
        sep.heightAnchor.constraint(equalToConstant: flagCGFloat("kb.suggestion.dividerHeight", 18)).isActive = true
        row.addArrangedSubview(sep)
      }
      let chip = UIButton(type: .system)
      // Quote a revert so it reads as "keep what you typed" rather than as
      // another word being suggested to you.
      chip.setTitle(isRevert ? "\u{201C}\(s)\u{201D}" : s, for: .normal)
      chip.setTitleColor(isLead ? leadFg : chipFg, for: .normal)
      chip.titleLabel?.font = .systemFont(ofSize: fontSize, weight: isLead ? .semibold : .regular)
      // Flat mode paints no surface at all — the words sit on the bar, native
      // style. The lead still reads as the lead through weight and colour.
      chip.backgroundColor = flatStyle ? .clear : (isLead ? leadBg : chipBg)
      if flatStyle, isLead { chip.setTitleColor(leadBg, for: .normal) }
      chip.layer.cornerRadius = flatStyle ? 0 : chipRadius
      if !flatStyle, !isLead, borderWidth > 0 {
        chip.layer.borderWidth = borderWidth
        chip.layer.borderColor = borderColor.cgColor
      }
      chip.contentEdgeInsets = UIEdgeInsets(top: chipPadV, left: chipPadH, bottom: chipPadV, right: chipPadH)
      let action = UIAction { [weak self] _ in
        self?.applySuggestion(s)
      }
      chip.addAction(action, for: .touchUpInside)
      row.addArrangedSubview(chip)
    }
  }

  /// One-shot latch for the remount fallback below: a tree with NO
  /// SuggestionBar node at all would otherwise remount on EVERY completion
  /// update (the snapshot can't see suggestions), reintroducing the
  /// per-keystroke rebuild. Cleared when a bar actually mounts.
  private var suggestionBarRemountAttempted = false

  fileprivate func updateSuggestionBarInPlace() {
    guard let row = suggestionRowStack, row.window != nil else {
      // No live bar: a backend tree may gate the SuggestionBar node on
      // state.hasSuggestions (visibleIf CULLS it, so there's no row to fill
      // in place). Remount ONCE so the gate re-evaluates — if the tree simply
      // has no bar, don't keep paying rebuilds for it.
      if !state.suggestions.isEmpty, !suggestionBarRemountAttempted {
        suggestionBarRemountAttempted = true
        stateChanged()
      }
      return
    }
    suggestionBarRemountAttempted = false
    renderSuggestionChips(into: row)
    // Chips are obstacles for the touch plane's top-row reach; refresh the
    // veto list AFTER the chips have frames (next runloop tick) — collecting
    // them pre-layout records zero-sized rects that filter out.
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.keyPlane?.setObstacles(self.collectPlaneObstacles())
    }
  }

  /// Every live, enabled control in the mounted tree that the plane must not
  /// steal touches from. Plane-managed letter keys have userInteraction OFF,
  /// so they're excluded naturally.
  private func collectPlaneObstacles() -> [UIView] {
    guard let rootV = mountedRoot else { return [] }
    var out: [UIView] = []
    func walk(_ v: UIView) {
      // NOTE: no isEnabled check — a DISABLED control (e.g. mic with voice
      // off) must still block the plane; its area going to a letter would
      // type where the user expected a dead button.
      if let c = v as? UIControl, c.isUserInteractionEnabled, !c.isHidden {
        out.append(c)
      }
      for s in v.subviews { walk(s) }
    }
    walk(rootV)
    return out
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
    // A real (non-plane) key going down flushes any still-held plane letters
    // first, so letter→space / letter→shift overlaps keep press order. Plane-
    // managed letters have isUserInteractionEnabled == false and reach here
    // via planeDown instead — they must NOT flush (their own touch was just
    // registered by the same event).
    if btn.isUserInteractionEnabled { keyPlane?.flushPendingCommits() }
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

  /// Balance an outstanding planeDown whose button no longer exists (a
  /// layer-peek remount deallocated it). Only the counter + callout need
  /// closing — there is no view left to restore.
  fileprivate func planeUpLost() {
    planeActiveTouchCount = max(0, planeActiveTouchCount - 1)
    hideKeyCallout()
  }

  /// Commit the character under the finger on release. Routes through the exact
  /// insertKey path a button tap uses, so live shift / capsLock casing applies.
  fileprivate func planeCommit(char: String) {
    KeyboardTelemetry.bump(.keystrokes)
    run(.inline(.insertKey(char: char)))
  }

  /// Selection-changed haptic on every key. Requires Full Access to fire; the
  /// generator silently no-ops without it. Cheaper than instantiating a new
  /// generator per tap.
  private var selectionGenerator: UISelectionFeedbackGenerator?
  /// Backend-tunable, because key haptics are the single most polarizing
  /// keyboard setting and this used to need a rebuild to change at all:
  ///   kb.haptics.enabled  (bool,   default true)  — master switch
  ///   kb.haptics.style    (string, default "selection") — "selection" |
  ///                       "light" | "medium" | "heavy" | "rigid" | "soft"
  /// Full Access is still required by iOS; without it the generator no-ops.
  private var impactGenerator: UIImpactFeedbackGenerator?
  private var impactGeneratorStyle: String = ""

  fileprivate func fireKeyHaptic() {
    guard host?.hostHasFullAccess == true else { return }
    guard flagBool("kb.haptics.enabled", true) else { return }
    let style = flagString("kb.haptics.style", "selection").lowercased()
    if style == "selection" {
      if selectionGenerator == nil { selectionGenerator = UISelectionFeedbackGenerator() }
      selectionGenerator?.selectionChanged()
      selectionGenerator?.prepare() // pre-cache the next one
      return
    }
    // Impact styles. The generator is rebuilt only when the style actually
    // changes — allocating one per keystroke would cost real time on the
    // typing hot path.
    if impactGenerator == nil || impactGeneratorStyle != style {
      var mapped: UIImpactFeedbackGenerator.FeedbackStyle = .medium
      switch style {
      case "light": mapped = .light
      case "heavy": mapped = .heavy
      case "rigid": if #available(iOS 13.0, *) { mapped = .rigid }
      case "soft": if #available(iOS 13.0, *) { mapped = .soft }
      default: break
      }
      impactGenerator = UIImpactFeedbackGenerator(style: mapped)
      impactGeneratorStyle = style
    }
    impactGenerator?.impactOccurred()
    impactGenerator?.prepare()
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
      // Layer-switch keys register for the plane's layer-peek handling (press
      // → instant switch; press-slide-release → peek). Detected here in the
      // SHARED tap binder — not in buildLetterKey — so a "123" shipped as an
      // IconKey (or any node type) gets peek instead of silently keeping a
      // touchUpInside that would remount mid-callback.
      if case .switchLayout(let target)? = resolve(ref) {
        layerKeyRegistry.append((btn, target))
      }
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
      let inserted = applySmartPunctuation(text)
      proxy?.insertText(inserted)
      noteTyped(inserted)
      updateAutoCap(afterTyping: inserted)
    case .insertKey(let char):
      // Derive case from LIVE state at tap time (not baked at render) so the
      // fast-shift in-place re-title never desyncs from what actually inserts.
      // Mirrors buildLetterKey's title logic: single-char → cased, multi-char
      // (or symbol/digit payloads) → inserted verbatim.
      let cased = char.count == 1
        ? ((state.shift || state.capsLock) ? char.uppercased() : char.lowercased())
        : char
      var inserted = applySmartPunctuation(cased)
      // Auto-space pull-back: a suggestion just inserted "word " — terminal
      // punctuation typed next replaces that space, then re-adds it:
      // "word ," → "word, ". Native behavior for accepted predictions.
      if pendingAutoSpace {
        pendingAutoSpace = false
        if inserted.count == 1, let c = inserted.first,
           ",.!?;:)]…\u{2019}\u{201D}".contains(c) {
          proxy?.deleteBackward()
          inserted = String(c) + " "
        }
      }
      proxy?.insertText(inserted)
      // A character between two shift taps breaks the double-tap-caps chain, so
      // clear the timer — otherwise "shift, type a, shift" wrongly engaged caps.
      lastShiftTapTime = 0
      if state.shift && !state.capsLock {
        state.shift = false
        stateChanged()
      }
      noteTyped(inserted)
      updateAutoCap(afterTyping: inserted)
    case .deleteBackward:
      // Backspace right after an autocorrect UNDOES it (consumes the press) —
      // the fastest revert path, matching user muscle memory.
      if maybeRevertAutocorrectOnDelete() { return }
      proxy?.deleteBackward()
      noteDeletedBackward()
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
      // deleteWord stops AT a whitespace/newline (or an empty doc) — a clean
      // boundary, so the tracker stays armed for the next word.
      resetTypingContext(tailAtBoundary: true)
    case .shift:
      state.shift.toggle()
      stateChanged()
    case .capsLock:
      state.capsLock.toggle()
      state.shift = state.capsLock ? true : state.shift
      stateChanged()
    case .returnKey:
      // Capture the context BEFORE the newline: most hosts scope
      // documentContextBeforeInput to the current line, so the boundary
      // pipeline could never verify the finished word after the insert. Only
      // pay the read when a correction/expansion could actually apply.
      let preCtx: String? = (!currentWord.isEmpty && trackerValid)
        ? (proxy?.documentContextBeforeInput ?? "") : nil
      proxy?.insertText("\n")
      lastAutocorrect = nil
      lastInsertedChar = "\n"
      pendingAutoSpace = false
      // Bump BEFORE the boundary pipeline captures it: the newline path skips
      // the post-hoc context verification (line-scoped context), so the
      // generation counter is its ONLY race guard — without this bump a
      // second Return arriving before the async checker finished let the
      // correction replaceTail against moved text.
      typingGeneration += 1
      handleWordBoundary(boundary: "\n", preInsertContext: preCtx)
      // Native returns to the letter layer after a return from 123/#+=.
      autoReturnToLetters()
      updateAutoCap()
    case .switchLayout(let language):
      let langs = (config.layouts ?? []).map { $0.language }
      if let target = language, langs.contains(target) {
        state.layoutId = target
      } else if !langs.isEmpty {
        let idx = langs.firstIndex(of: state.layoutId) ?? -1
        state.layoutId = langs[(idx + 1) % langs.count]
      }
      // Layer-peek (the plane's touch-down switch) NEEDS a synchronous
      // remount — the new layer's keys must be bound before the finger's
      // next move event, and the plane view survives the rebuild. Every
      // OTHER path into switchLayout is a real UIControl's action handler
      // (ABC/123 tap with the plane off, backend sequences): a synchronous
      // remount there deallocates the very button mid-callback, so those
      // defer one runloop tick.
      if planePeekInProgress {
        remount()
      } else {
        DispatchQueue.main.async { [weak self] in self?.remount() }
      }
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
      // Cycle through the backend tone list (kb.personality.tones). The pill
      // shows the LABEL; persistTonePick carries the ID to the refine
      // pipeline + server so the choice actually sticks.
      let tones = configuredTones()
      let idx = tones.firstIndex(where: { $0.label.caseInsensitiveCompare(state.tone) == .orderedSame }) ?? -1
      let next = tones[(idx + 1) % max(1, tones.count)]
      state.tone = next.label
      stateChanged()
      persistTonePick(id: next.id)
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
  /// `afterTyping` is the text just inserted, when the caller knows it. For a
  /// plain letter/digit that knowledge is enough to decide autocap locally —
  /// the char before the cursor IS that letter, so neither .sentences nor
  /// .words wants a cap next — skipping the documentContextBeforeInput read.
  /// That read is an XPC round-trip to the host app on EVERY keystroke; the
  /// system keyboard pays no such tax, and this fast path removes ours for the
  /// most common case. Word boundaries / deletes still do the real read.
  private func updateAutoCap(afterTyping typed: String? = nil) {
    // Backend flag: kb.autoCap.enabled (default true) — global auto-cap kill switch
    guard flagBool("kb.autoCap.enabled", true) else { return }
    guard let host = host else { return }
    if state.capsLock { return } // caps lock wins; don't fight the user
    let mode = host.hostAutocapitalizationType()
    if mode == .none { return }
    let shouldCap: Bool
    if mode != .allCharacters,
       let t = typed, t.count == 1, let c = t.first, c.isLetter || c.isNumber {
      shouldCap = false   // fast path: no proxy read
    } else {
      let ctx = host.hostTextDocumentProxy.documentContextBeforeInput ?? ""
      switch mode {
      case .allCharacters:
        shouldCap = true
      case .words:
        shouldCap = ctx.isEmpty || (ctx.last?.isWhitespace ?? true)
      case .sentences:
        if ctx.isEmpty { shouldCap = true }
        else if ctx.last == "\n" || ctx.hasSuffix("\n ") {
          // New line/paragraph → sentence start. Checked BEFORE the whitespace
          // strip below: "\n".isWhitespace is true, so drop(while:) swallowed
          // the newline and the old `last == "\n"` comparison was dead code —
          // every new line started lowercase.
          shouldCap = true
        }
        else {
          // Look back past trailing whitespace, then check the last non-space
          // for a sentence-ending mark.
          let trimmed = ctx.reversed().drop(while: { $0.isWhitespace })
          let hadSpace = ctx.count != trimmed.count
          if let last = trimmed.first {
            shouldCap = hadSpace && (last == "." || last == "?" || last == "!")
          } else {
            shouldCap = true
          }
        }
      @unknown default:
        shouldCap = false
      }
    }
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
    guard on, text.count == 1, let ch = text.first,
          ch == "\"" || ch == "'" || ch == "-" || ch == "."
    else { return text }
    // Only the four trigger characters ever read the document context — the
    // old guard let EVERY letter fall through to a documentContextBeforeInput
    // read (an XPC round-trip to the host app) before returning it unchanged.
    guard let proxy = host?.hostTextDocumentProxy else { return text }
    // Respect the FIELD's smart-typography traits, like the system keyboard:
    // code editors / identifier fields set these to .no and a curly quote
    // there is corruption, not typography.
    let traits = proxy as? UITextInputTraits
    if (ch == "\"" || ch == "'"), traits?.smartQuotesType == UITextSmartQuotesType.no {
      return text
    }
    if ch == "-", traits?.smartDashesType == UITextSmartDashesType.no {
      return text
    }
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

  // MARK: - Autocorrect + word suggestions (on-device)
  //
  // The intelligence layer the keyboard lacked vs the system one. Fully local
  // and synchronous-cheap: UITextChecker supplies misspelling detection,
  // guesses and completions; the LIVE key geometry re-ranks guesses by tap
  // adjacency (a candidate differing from the typed word only by neighbor-key
  // substitutions is almost certainly what the finger meant). Corrections fire
  // at word boundaries (space / return / punctuation) exactly like the system
  // keyboard and Wispr's QWERTY layer. Backend flags:
  //   kb.autocorrect.enabled      (default false — backend owns rollout)
  //   kb.autocorrect.minLen       (default 3)  — shortest word we'll correct
  //   kb.autocorrect.maxDistance  (default 2)  — weighted edit-distance cap
  //   kb.autocorrect.lang         (default "" — derive from primaryLanguage)
  //   kb.suggestions.enabled      (default false) — completion chips while typing
  //   kb.suggestions.max          (default 3)
  //   kb.touch.lmBias.enabled / .pt + kb.touch.bigrams
  //     — next-letter hit-target bias, consumed by KeyPlaneView.keyAt.

  /// The word being typed since the last boundary. A best-effort mirror of the
  /// document tail: handleWordBoundary VERIFIES it against the real context
  /// before touching the document, so a stale mirror can never corrupt text.
  private var currentWord = ""
  /// False when the tracker may be a strict SUFFIX of the real trailing word —
  /// e.g. after deleting past a boundary ("help·" ⌫ → tracker empty, doc tail
  /// "help") and typing on ("ing" tracked, doc "helping"). ctx.hasSuffix alone
  /// can't catch that, and correcting the suffix corrupts the word. Restored
  /// at the next word boundary (a fresh word starts fully tracked).
  private var trackerValid = true
  /// True right after a suggestion insert added its trailing auto-space.
  /// Typing terminal punctuation next pulls that space back ("word ," →
  /// "word, ") — the native auto-space pull-back.
  private var pendingAutoSpace = false
  /// Last applied correction, kept so the suggestion bar can offer the typed
  /// original as a one-tap revert (native behavior), and so a backspace right
  /// after the correction undoes it (kb.autocorrect.backspaceRevert).
  private var lastAutocorrect: (original: String, corrected: String, boundary: String)?
  /// Last word this engine COMMITTED whole (swipe insert, confusable offer
  /// target) — suggestion chips replace it in place.
  private var lastCommittedWord: (word: String, boundary: String)?
  /// Bumped on every text mutation; async checker results are dropped when
  /// the generation moved (the user typed on while the checker ran).
  private var typingGeneration = 0
  /// Parsed kb.autocorrect.confusables: word → alternatives to OFFER (never
  /// auto-replace — real-word swaps are suggestions, not corrections).
  private var parsedConfusables: [String: [String]]?
  /// Background spell-check lane: UITextChecker work (guesses can cost
  /// 10-30ms) stays off the tap handler. Serial queue = single-thread
  /// confinement for the non-thread-safe checker.
  private static let spellQueue = DispatchQueue(label: "kb.spellcheck", qos: .userInitiated)
  private static let bgChecker = UITextChecker()
  /// Last single character inserted — seeds the bigram bias for the NEXT touch.
  fileprivate var lastInsertedChar: String?
  /// Parsed kb.touch.bigrams: previous char → set of likely next chars.
  private var parsedBigrams: [String: Set<String>]?
  /// Physical key adjacency derived from the live button frames; rebuilt after
  /// every remount (see remount()).
  fileprivate var cachedNeighborMap: [Character: Set<Character>]?
  private var cachedCheckerLang: String?

  /// Likely next letters after the last insert, for KeyPlaneView's hit-target
  /// bias. Empty when the table has no row (or nothing was typed yet).
  fileprivate func lmLikelyNext() -> Set<String> {
    guard let prev = lastInsertedChar?.lowercased() else { return [] }
    if parsedBigrams == nil {
      var out: [String: Set<String>] = [:]
      if case .object(let table)? = config.flags?["kb.touch.bigrams"] {
        for (k, v) in table {
          guard let s = v.asString else { continue }
          out[k.lowercased()] = Set(s.map { String($0) })
        }
      }
      parsedBigrams = out
    }
    return parsedBigrams?[prev] ?? []
  }

  /// Called after every self-initiated insert with the EXACT text that landed
  /// (post smart-punctuation). Maintains the word tracker, the bigram seed,
  /// and fires the boundary pipeline on terminators.
  private func noteTyped(_ inserted: String) {
    lastAutocorrect = nil
    lastCommittedWord = nil
    typingGeneration += 1
    if inserted.count == 1, let c = inserted.first {
      lastInsertedChar = inserted
      if c == "'" || c == "\u{2019}" || c.isLetter || c.isNumber {
        currentWord.append(c)
        refreshSuggestions()
      } else if c.isWhitespace || c.isNewline || c.isPunctuation {
        handleWordBoundary(boundary: inserted)
      } else {
        resetTypingContext()
      }
    } else {
      // Multi-char insert (suggestion, backend insertText, transformed
      // punctuation) — tracking a word through it isn't reliable; reset.
      lastInsertedChar = inserted.last.map(String.init)
      resetTypingContext()
    }
  }

  private func noteDeletedBackward() {
    lastAutocorrect = nil
    lastCommittedWord = nil
    typingGeneration += 1
    lastInsertedChar = nil   // unknown context now — bias off until next insert
    pendingAutoSpace = false
    if currentWord.isEmpty {
      // Deleting past what we tracked: the doc tail may now end mid-word with
      // untracked characters in front of anything typed next. Corrections are
      // unsafe until the next boundary.
      trackerValid = false
    } else {
      currentWord.removeLast()
    }
    refreshSuggestions()
  }

  /// Forget the tracked word + revert state. Called whenever the text around
  /// the cursor changed in a way the tracker can't follow. `tailAtBoundary`
  /// says whether the document is KNOWN to end at a word boundary right now
  /// (suggestion just inserted "word ", dictation committed with a trailing
  /// space) — if not, corrections stay disabled until the next boundary.
  func resetTypingContext(tailAtBoundary: Bool = false) {
    currentWord = ""
    lastAutocorrect = nil
    lastCommittedWord = nil
    typingGeneration += 1
    pendingAutoSpace = false
    trackerValid = tailAtBoundary
    if !state.suggestions.isEmpty {
      state.suggestions = []
      updateSuggestionBarInPlace()
    }
  }

  /// The word just ended (boundary landed in the document already, except for
  /// the return key — see `preInsertContext`). Order: text expansion (exact
  /// trigger) wins, then spell correction. ONE context read happens here — at
  /// the boundary, not per keystroke — and it doubles as the safety check
  /// that the tracker matches reality.
  ///
  /// `preInsertContext`: for "\n" boundaries the caller passes the context it
  /// read BEFORE inserting the newline — most hosts scope
  /// documentContextBeforeInput to the current line, so reading after the
  /// insert comes back empty and the verification could never pass.
  private func handleWordBoundary(boundary: String, preInsertContext: String? = nil) {
    lastAutocorrect = nil
    let word = currentWord
    currentWord = ""
    let wasValid = trackerValid
    trackerValid = true   // a boundary just landed — the next word starts fully tracked
    if !state.suggestions.isEmpty {
      state.suggestions = []
      updateSuggestionBarInPlace()
    }
    guard wasValid, !word.isEmpty, let proxy = host?.hostTextDocumentProxy else { return }
    // Respect the field: URL / email / code fields opt out of correction.
    guard host?.hostAutocorrectionType() != UITextAutocorrectionType.no else { return }
    let expansion = host?.hostExpansion(for: word)
    let autocorrectOn = flagBool("kb.autocorrect.enabled", false)
    guard expansion != nil || autocorrectOn else { return }
    let ctx: String = preInsertContext.map { $0 + boundary }
      ?? (proxy.documentContextBeforeInput ?? "")
    guard ctx.hasSuffix(word + boundary) else { return }
    // The char BEFORE the matched word must itself be a boundary (or nothing).
    // Without this, a tracker that is a strict suffix of the real word — e.g.
    // "ing" against doc "helping" — passes hasSuffix and the replace corrupts
    // the word. Belt-and-suspenders on top of the trackerValid gate.
    let head = ctx.dropLast(word.count + boundary.count)
    if let p = head.last,
       p.isLetter || p.isNumber || p == "'" || p == "\u{2019}" {
      return
    }

    // 1) Text expansion — the user's own dictionary + the iOS supplementary
    //    lexicon (contact names, Settings text replacements), via the host.
    if let repl = expansion, repl != word {
      replaceTail(count: word.count + boundary.count, with: repl + boundary, proxy: proxy)
      return
    }
    guard autocorrectOn else { return }

    // 2) Spell correction — ASYNC (K7). rangeOfMisspelledWord + guesses cost
    // 10-30ms on older devices, which used to ride inside the space-tap
    // handler. The check runs on the spell queue; the result applies back on
    // main ONLY if the document tail is still exactly word+boundary (a
    // generation counter + a fresh context read guard the race).
    let minLen = Int(flagDouble("kb.autocorrect.minLen", 3))
    guard word.count >= minLen, word.count <= 24 else { return }
    // Plain ASCII letters (+apostrophe) only: digits, symbols, and accented
    // words (deliberately picked from the tray) are left alone.
    guard word.allSatisfy({ ($0.isLetter && $0.isASCII) || $0 == "'" || $0 == "\u{2019}" })
    else { return }
    let lang = autocorrectLanguage()
    let neighbors = keyNeighborMap()
    let maxDist = flagDouble("kb.autocorrect.maxDistance", 2.0)
    // Captured on main (the flag store isn't queue-safe) and handed to the
    // static scorer running on the spell queue.
    let neighborCost = flagDouble("kb.autocorrect.neighborCost", 0.5)
    let punctCost = flagDouble("kb.autocorrect.punctCost", 0.5)
    let generation = typingGeneration
    let isNewline = boundary == "\n"
    Self.spellQueue.async { [weak self] in
      let ns = word as NSString
      let full = NSRange(location: 0, length: ns.length)
      let miss = Self.bgChecker.rangeOfMisspelledWord(
        in: word, range: full, startingAt: 0, wrap: false, language: lang)
      guard miss.location != NSNotFound else {
        // Spelled fine — real-word confusables ("their/there") are OFFERED
        // as chips, never auto-swapped.
        DispatchQueue.main.async {
          guard let self = self, self.typingGeneration == generation else { return }
          self.offerConfusables(for: word, boundary: boundary)
        }
        return
      }
      let guesses = Self.bgChecker.guesses(forWordRange: full, in: word, language: lang) ?? []
      guard let corrected = SDUIRenderer.pickCorrection(
        for: word, from: guesses, neighbors: neighbors, maxDist: maxDist,
        neighborCost: neighborCost, punctCost: punctCost) else { return }
      DispatchQueue.main.async {
        self?.applyAsyncCorrection(word: word, boundary: boundary, corrected: corrected,
                                   generation: generation, newlineBoundary: isNewline)
      }
    }
  }

  /// Apply a background-checked correction — only while it's still safe: the
  /// generation must not have moved, and (except for newline boundaries,
  /// where the context is line-scoped and unreadable) the document tail must
  /// still be exactly word+boundary.
  private func applyAsyncCorrection(word: String, boundary: String, corrected: String,
                                    generation: Int, newlineBoundary: Bool) {
    guard typingGeneration == generation, let proxy = host?.hostTextDocumentProxy else { return }
    let cased = matchCase(of: word, to: corrected)
    guard cased != word else { return }
    if !newlineBoundary {
      let ctx = proxy.documentContextBeforeInput ?? ""
      guard ctx.hasSuffix(word + boundary) else { return }
      let head = ctx.dropLast(word.count + boundary.count)
      if let p = head.last, p.isLetter || p.isNumber || p == "'" || p == "\u{2019}" { return }
    }
    replaceTail(count: word.count + boundary.count, with: cased + boundary, proxy: proxy)
    typingGeneration += 1
    lastAutocorrect = (word, cased, boundary)
    // Denominator for the revert rate — the pair is what makes the signal
    // meaningful ("4 reverts" means nothing without "out of how many").
    KeyboardTelemetry.bump(.autocorrectApplied)
    // Revert affordance: the typed original shows as a chip; tapping restores it.
    state.suggestionKind = "revert"
    state.suggestions = [word]
    updateSuggestionBarInPlace()
  }

  /// Real-word confusion pairs (kb.autocorrect.confusables). The word is
  /// spelled fine, so it's never auto-replaced — the alternatives appear as
  /// chips that swap the committed word in place.
  private func offerConfusables(for word: String, boundary: String) {
    if parsedConfusables == nil {
      var out: [String: [String]] = [:]
      if case .object(let table)? = config.flags?["kb.autocorrect.confusables"] {
        for (k, v) in table {
          if let arr = v.asArray { out[k.lowercased()] = arr.compactMap { $0.asString } }
          else if let s = v.asString { out[k.lowercased()] = [s] }
        }
      }
      parsedConfusables = out
    }
    guard let alts = parsedConfusables?[word.lowercased()], !alts.isEmpty else { return }
    lastCommittedWord = (word, boundary)
    state.suggestionKind = "alternates"
    state.suggestions = alts.map { matchCase(of: word, to: $0) }
    updateSuggestionBarInPlace()
  }

  private func replaceTail(count: Int, with text: String, proxy: UITextDocumentProxy) {
    for _ in 0..<count { proxy.deleteBackward() }
    proxy.insertText(text)
  }

  /// Best guess within the edit-distance budget, or nil to leave the word
  /// alone. Deliberately conservative: a wrong correction costs the user far
  /// more trust than a missed one. Static + parameterized so it runs on the
  /// spell queue with values captured on main.
  private static func pickCorrection(for typed: String, from guesses: [String],
                                     neighbors: [Character: Set<Character>],
                                     maxDist: Double,
                                     neighborCost: Double,
                                     punctCost: Double) -> String? {
    guard !guesses.isEmpty else { return nil }
    var best: (word: String, dist: Double)?
    for g in guesses.prefix(8) {
      guard !g.isEmpty, abs(g.count - typed.count) <= 1 else { continue }
      let d = weightedEditDistance(
        Array(typed.lowercased()), Array(g.lowercased()), neighbors: neighbors,
        neighborCost: neighborCost, punctCost: punctCost)
      if d <= maxDist, best == nil || d < best!.dist { best = (g, d) }
    }
    return best?.word
  }

  /// Levenshtein with keyboard-aware costs: substituting a key for one of its
  /// physical neighbors costs `neighborCost` (a fat-finger, not a different
  /// word); inserting a missing apostrophe or word-splitting space costs
  /// `punctCost` ("dont" → "don\'t", "alot" → "a lot"); everything else 1.
  ///
  /// Both are backend-tunable (kb.autocorrect.neighborCost / .punctCost)
  /// because together with kb.autocorrect.maxDistance they ARE the
  /// aggressiveness dial: lower costs mean more words get "fixed". A wrong
  /// correction costs far more trust than a missed one, so this needs to be
  /// adjustable without a rebuild.
  private static func weightedEditDistance(_ a: [Character], _ b: [Character],
                                           neighbors: [Character: Set<Character>],
                                           neighborCost: Double,
                                           punctCost: Double) -> Double {
    let n = a.count, m = b.count
    guard n > 0, m > 0 else { return Double(max(n, m)) }
    var prev = (0...m).map { Double($0) }
    var cur = [Double](repeating: 0, count: m + 1)
    for i in 1...n {
      cur[0] = Double(i)
      for j in 1...m {
        let subCost: Double
        if a[i-1] == b[j-1] { subCost = 0 }
        else if neighbors[a[i-1]]?.contains(b[j-1]) == true { subCost = neighborCost }
        else { subCost = 1 }
        let insCost: Double = (b[j-1] == "'" || b[j-1] == " ") ? punctCost : 1
        cur[j] = min(prev[j-1] + subCost,   // substitute
                     prev[j] + 1,           // drop a typed char
                     cur[j-1] + insCost)    // insert a candidate char
      }
      swap(&prev, &cur)
    }
    return prev[m]
  }

  /// Physical adjacency from the LIVE key frames (letterButtonsByChar), so the
  /// model is always true for whatever layout the backend shipped — no
  /// hardcoded QWERTY table. 1.8× key width catches orthogonal + diagonal
  /// neighbors and nothing further.
  private func keyNeighborMap() -> [Character: Set<Character>] {
    if let m = cachedNeighborMap { return m }
    var centers: [(ch: Character, p: CGPoint, w: CGFloat)] = []
    for (str, btn) in letterButtonsByChar {
      guard str.count == 1, let c = str.first, c.isLetter,
            let sup = btn.superview, btn.window != nil else { continue }
      let f = sup.convert(btn.frame, to: mountContainer)
      guard f.width > 0 else { continue }
      centers.append((c, CGPoint(x: f.midX, y: f.midY), f.width))
    }
    var m: [Character: Set<Character>] = [:]
    for a in centers {
      var s = Set<Character>()
      for b in centers where b.ch != a.ch {
        if hypot(a.p.x - b.p.x, a.p.y - b.p.y) < a.w * 1.8 { s.insert(b.ch) }
      }
      m[a.ch] = s
    }
    cachedNeighborMap = m
    return m
  }

  /// Mirror the typed word's casing onto the candidate: ALL-CAPS stays caps,
  /// leading cap stays capped, else the candidate as the checker offered it.
  private func matchCase(of typed: String, to candidate: String) -> String {
    guard let first = typed.first else { return candidate }
    if typed.count > 1, typed == typed.uppercased(), typed != typed.lowercased() {
      return candidate.uppercased()
    }
    if first.isUppercase {
      return candidate.prefix(1).uppercased() + candidate.dropFirst()
    }
    return candidate
  }

  /// UITextChecker language: kb.autocorrect.lang override, else the field's
  /// primary language, resolved against the checker's available set.
  private func autocorrectLanguage() -> String {
    if let l = cachedCheckerLang { return l }
    let flagged = flagString("kb.autocorrect.lang", "")
    let want = (flagged.isEmpty ? state.primaryLanguage : flagged).lowercased()
    let avail = UITextChecker.availableLanguages
    let match = avail.first { $0.lowercased() == want }
      ?? avail.first { $0.lowercased().hasPrefix(want) }
      ?? "en_US"
    cachedCheckerLang = match
    return match
  }

  /// Completion chips for the in-progress word. In-place bar update — never a
  /// remount (a remount per keystroke is the 30-80ms tap lag this renderer
  /// spent so much effort killing).
  private func refreshSuggestions() {
    guard flagBool("kb.suggestions.enabled", false),
          host?.hostAutocorrectionType() != UITextAutocorrectionType.no else {
      // Feature off (or field opted out): make sure no stale chip — e.g. an
      // autocorrect revert chip — outlives the keystroke that follows it.
      if !state.suggestions.isEmpty {
        state.suggestions = []
        updateSuggestionBarInPlace()
      }
      return
    }
    guard currentWord.count >= 2,
          currentWord.allSatisfy({ ($0.isLetter && $0.isASCII) || $0 == "'" || $0 == "\u{2019}" })
    else {
      if !state.suggestions.isEmpty {
        state.suggestions = []
        updateSuggestionBarInPlace()
      }
      return
    }
    // Completions off the keystroke path (K7): computed on the spell queue,
    // applied only if the word is still what the user is typing.
    let word = currentWord
    let lang = autocorrectLanguage()
    let maxN = max(1, Int(flagDouble("kb.suggestions.max", 3)))
    Self.spellQueue.async { [weak self] in
      let ns = word as NSString
      let comps = Self.bgChecker.completions(
        forPartialWordRange: NSRange(location: 0, length: ns.length),
        in: word, language: lang) ?? []
      let out = Array(comps.prefix(maxN))
      DispatchQueue.main.async {
        guard let self = self, self.currentWord == word else { return }
        if self.state.suggestions != out {
          self.state.suggestions = out
          self.updateSuggestionBarInPlace()
        }
      }
    }
  }

  /// A suggestion chip was tapped: revert chip restores the pre-autocorrect
  /// text; completion chip replaces the in-progress word. An empty tracker
  /// falls through to a plain append — that keeps backend-driven suggestion
  /// lists (setState) working exactly as before.
  fileprivate func applySuggestion(_ s: String) {
    guard let proxy = host?.hostTextDocumentProxy else { return }
    if let last = lastAutocorrect, s == last.original {
      let ctx = proxy.documentContextBeforeInput ?? ""
      if ctx.hasSuffix(last.corrected + last.boundary) {
        replaceTail(count: last.corrected.count + last.boundary.count,
                    with: last.original + last.boundary, proxy: proxy)
      }
      resetTypingContext(tailAtBoundary: true)
      updateAutoCap()
      return
    }
    // Swipe alternates + confusable offers: the chip replaces the last word
    // this engine committed whole. The bar STAYS up (native behavior): the
    // untapped alternates plus the word just swapped out remain available,
    // so the user can keep flipping until they like it.
    if let lc = lastCommittedWord {
      let ctx = proxy.documentContextBeforeInput ?? ""
      if ctx.hasSuffix(lc.word + lc.boundary) {
        let remaining = state.suggestions.filter { $0 != s } + [lc.word]
        replaceTail(count: lc.word.count + lc.boundary.count,
                    with: s + lc.boundary, proxy: proxy)
        lastInsertedChar = lc.boundary.last.map(String.init)
        resetTypingContext(tailAtBoundary: true)
        lastCommittedWord = (s, lc.boundary)
        state.suggestions = remaining
        updateSuggestionBarInPlace()
        updateAutoCap()
        return
      }
      lastCommittedWord = nil
    }
    let word = currentWord
    let ctx = proxy.documentContextBeforeInput ?? ""
    guard trackerValid, word.isEmpty || ctx.hasSuffix(word) else {
      resetTypingContext()
      return
    }
    // Same strict-suffix guard as the boundary pipeline: replacing "ing" when
    // the document says "helping" must not fire.
    if !word.isEmpty {
      let head = ctx.dropLast(word.count)
      if let p = head.last, p.isLetter || p.isNumber || p == "'" || p == "\u{2019}" {
        resetTypingContext()
        return
      }
    }
    let cased = matchCase(of: word, to: s)
    // An empty tracker means the chip is appending, not replacing — make sure
    // it doesn't weld onto a trailing word ("hello" + chip → "hello world ").
    let needsLead = word.isEmpty
      && !(ctx.isEmpty || ctx.last!.isWhitespace || ctx.last!.isNewline)
    replaceTail(count: word.count, with: (needsLead ? " " : "") + cased + " ", proxy: proxy)
    lastInsertedChar = " "
    resetTypingContext(tailAtBoundary: true)
    pendingAutoSpace = true   // typing punctuation next pulls the space back
    updateAutoCap()
  }

  // MARK: - QuickPath swipe typing (K7)
  //
  // The plane promotes a single-finger glide across ≥ kb.swipe.minKeys keys
  // into a swipe; on lift the swept key sequence decodes into a word:
  //   • candidates must anchor to the swipe's first and last keys (± physical
  //     neighbors) — the strongest constraint in shape writing,
  //   • every letter must appear IN ORDER along the swept keys (exact key or
  //     neighbor; doubled letters ride one key; apostrophes are free),
  //   • ranked by corpus frequency (embedded list + kb.swipe.extraWords),
  //     subsequence exactness, and length affinity.
  // Best candidate inserts with a trailing auto-space; runners-up land in the
  // suggestion bar and swap in place via lastCommittedWord.

  /// Frequency-ordered core lexicon. Deliberately compact — the goal is the
  /// words people actually glide (function words + everyday vocabulary); the
  /// backend extends OTA via kb.swipe.extraWords. A single multi-line literal
  /// (no `+` chain — 29 chained overloaded operators is how a file earns
  /// "unable to type-check in reasonable time").
  private static let swipeCoreWords: [String] = """
    the be to of and a in that have i it for not on with he as you do at this
    but his by from they we say her she or an will my one all would there their
    what so up out if about who get which go me when make can like time no just
    him know take people into year your good some could them see other than then
    now look only come its over think also back after use two how our work first
    well way even new want because any these give day most us is was are been has
    had were said did having may should am place made find where much too very
    still being going before great same those both does another around thought
    while together children saw few though feel man men woman women child life
    world school state family student group country problem hand part case week
    company system program question government number night point home water room
    mother area money story fact month lot right study book eye job word business
    issue side kind head house service friend father power hour game line end
    member law car city community name president team minute idea body information
    nothing ago face others level office door health person art war history party
    result change morning reason research girl guy moment air teacher force
    education call try ask need become leave put mean keep let begin seem help
    talk turn start show hear play run move live believe hold bring happen write
    provide sit stand lose pay meet include continue set learn lead understand
    watch follow stop create speak read allow add spend grow open walk win offer
    remember love consider appear buy wait serve die send expect build stay fall
    cut reach kill remain little important different small large next early young
    public bad able best better sure free low late hard major economic strong
    possible whole real american big high old hello thanks thank please sorry
    okay yeah cool nice awesome happy tomorrow today tonight later maybe really
    actually definitely probably haha gonna wanna gotta yes no here come coming
    meeting message send sent text call called calling home working dinner lunch
    coffee drink food great night week weekend friday monday tuesday wednesday
    thursday saturday sunday don't can't won't didn't i'm i'll i've it's that's
    what's you're we're they're isn't wasn't couldn't wouldn't shouldn't
    """.split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init)

  private var swipeWords: [String]?
  private func swipeLexicon() -> [String] {
    if let w = swipeWords { return w }
    var words = Self.swipeCoreWords
    if case .array(let extra)? = config.flags?["kb.swipe.extraWords"] {
      words.append(contentsOf: extra.compactMap { $0.asString?.lowercased() })
    }
    swipeWords = words
    return words
  }

  fileprivate func planeCanSwipe() -> Bool { !swipeLexicon().isEmpty }

  fileprivate func planeSwipeEngaged() {
    hideKeyCallout()
    fireKeyHaptic()
  }

  fileprivate func planeSwipeCommit(sweptChars: [String], pivots: [String] = []) {
    KeyboardTelemetry.bump(.swipeCommitted)
    let candidates = decodeSwipe(sweptChars, pivots: pivots)
    guard var best = candidates.first, let proxy = host?.hostTextDocumentProxy else { return }
    // "i" and its contractions capitalize themselves, like native.
    if best == "i" || best.hasPrefix("i'") {
      best = "I" + best.dropFirst()
    }
    if state.capsLock { best = best.uppercased() }
    else if state.shift { best = best.prefix(1).uppercased() + best.dropFirst() }
    // Separate from a trailing word, then insert with the auto-space.
    let ctx = proxy.documentContextBeforeInput ?? ""
    let lead = (ctx.isEmpty || ctx.last!.isWhitespace || ctx.last!.isNewline) ? "" : " "
    proxy.insertText(lead + best + " ")
    if state.shift && !state.capsLock {
      state.shift = false
      stateChanged()
    }
    lastInsertedChar = " "
    resetTypingContext(tailAtBoundary: true)
    pendingAutoSpace = true
    lastCommittedWord = (best, " ")
    let maxAlt = max(0, Int(flagDouble("kb.swipe.maxAlternates", 3)))
    let alts = candidates.dropFirst().prefix(maxAlt).map { matchCase(of: best, to: $0) }
    if !alts.isEmpty {
      state.suggestionKind = "candidates"
      state.suggestions = Array(alts)
      updateSuggestionBarInPlace()
    }
    updateAutoCap()
    fireKeyHaptic()
  }

  /// Decode a swept key sequence into ranked word candidates.
  private func decodeSwipe(_ swept: [String], pivots: [String] = []) -> [String] {
    let sweptChars: [Character] = swept.compactMap { $0.lowercased().first }
    guard sweptChars.count >= 2, let first = sweptChars.first, let last = sweptChars.last
    else { return [] }
    let neighbors = keyNeighborMap()
    // Core high-frequency list FIRST (rank drives the frequency score), then
    // dictionary candidates derived from this specific swipe — the core list
    // alone is ~350 words, so without this almost every real word a user
    // swipes has no entry to match at all.
    let core = swipeLexicon()
    let lexicon = core + dictionaryCandidates(for: sweptChars, pivots: pivots, excluding: Set(core))
    let total = max(1, core.count)

    // Pivot letters — where the finger actually turned. Treated as a hard
    // constraint below: a word that doesn't account for a deliberate corner
    // isn't what the user traced.
    let pivotChars: [Character] = pivots.compactMap { $0.lowercased().first }

    func near(_ a: Character, _ b: Character) -> Bool {
      a == b || neighbors[a]?.contains(b) == true
    }
    /// Letters of `word` (apostrophes skipped) must appear in order along the
    /// swept keys; doubled letters consume one key. Returns the share of
    /// exact-key (non-neighbor) matches, or nil when the shape doesn't fit.
    func subsequenceExactness(_ word: [Character]) -> Double? {
      var i = 0
      var exact = 0, matched = 0
      var prev: Character? = nil
      for wc in word {
        if wc == "'" || wc == "\u{2019}" { continue }
        if wc == prev { prev = wc; continue }   // doubled letter rides one key
        var found = false
        while i < sweptChars.count {
          let sc = sweptChars[i]
          i += 1
          if sc == wc { exact += 1; matched += 1; found = true; break }
          if near(sc, wc) { matched += 1; found = true; break }
        }
        if !found { return nil }
        prev = wc
      }
      return matched == 0 ? nil : Double(exact) / Double(matched)
    }

    /// Every letter the finger deliberately turned on must appear in the word,
    /// in order (neighbours allowed — a corner can land a key off).
    func coversPivots(_ letters: [Character]) -> Bool {
      guard pivotChars.count > 2 else { return true } // endpoints only: no info
      var i = 0
      for pc in pivotChars {
        var found = false
        while i < letters.count {
          let lc = letters[i]
          i += 1
          if near(lc, pc) { found = true; break }
        }
        if !found { return false }
      }
      return true
    }

    var scored: [(String, Double)] = []
    for (rank, word) in lexicon.enumerated() {
      let letters = Array(word.filter { $0 != "'" && $0 != "\u{2019}" })
      guard letters.count >= 2, letters.count <= sweptChars.count + 2 else { continue }
      guard let wf = letters.first, let wl = letters.last,
            near(first, wf), near(last, wl) else { continue }
      guard coversPivots(letters) else { continue }
      guard let exactness = subsequenceExactness(Array(word)) else { continue }
      // Dictionary-derived candidates sit past the core list, so their rank
      // would compute a negative frequency — floor it instead: they're valid
      // words, just without a frequency prior.
      let freq = rank < total ? 1.0 - Double(rank) / Double(total) : 0.0
      let lengthAffinity = 1.0 - min(
        1.0, abs(Double(sweptChars.count) - Double(letters.count) * 1.6) / Double(sweptChars.count))
      // A word that uses MORE of the pivots is more likely the traced one.
      let pivotBonus = pivotChars.count > 2
        ? min(1.0, Double(letters.count) / Double(max(1, pivotChars.count))) * 0.4
        : 0
      scored.append((word, freq * 2.0 + exactness * 1.5 + lengthAffinity * 0.6 + pivotBonus))
    }
    return scored.sorted { $0.1 > $1.1 }.prefix(4).map { $0.0 }
  }

  /// Real-dictionary candidates for THIS swipe.
  ///
  /// The curated list is a fast path for the few hundred most common words;
  /// everything else a user swipes ("invoice", "Thursday", their colleague's
  /// name) simply had no entry to match. UITextChecker carries the system
  /// dictionary we already use for autocorrect, so we hand it the swipe's own
  /// letters — the pivot letters spell a plausible skeleton, and the checker's
  /// guesses fill in the vowels a glide skips. The user's personal vocabulary
  /// is included too, since those are exactly the words a generic dictionary
  /// will never have.
  private func dictionaryCandidates(for swept: [Character], pivots: [String],
                                    excluding: Set<String>) -> [String] {
    var out: [String] = []
    var seen = excluding

    func consider(_ raw: String) {
      let w = raw.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
      guard w.count >= 2, !seen.contains(w) else { return }
      guard w.allSatisfy({ ($0.isLetter && $0.isASCII) || $0 == "'" || $0 == "\u{2019}" }) else { return }
      seen.insert(w)
      out.append(w)
    }

    // The user's own dictionary first — names and jargon no lexicon has.
    if let vocab = config.flags?["kb.personality.vocabulary"]?.asString {
      for term in vocab.split(whereSeparator: { $0 == "," || $0 == "\n" }) {
        consider(String(term))
      }
    }

    // Ask the spell checker to repair the swipe's own letter sequence. A glide
    // reads as a badly-misspelled word, which is precisely what guesses() is
    // built to fix.
    let lang = autocorrectLanguage()
    let skeletons: [String] = {
      var s: [String] = [String(swept)]
      let pivotWord = pivots.compactMap { $0.lowercased().first }
      if pivotWord.count >= 2 { s.append(String(pivotWord)) }
      return s
    }()
    for skeleton in skeletons {
      let ns = skeleton as NSString
      guard ns.length >= 2, ns.length <= 32 else { continue }
      let range = NSRange(location: 0, length: ns.length)
      // Bounded: this runs synchronously on the commit (once per swipe, not
      // per keystroke), so we take the top few and stop.
      let guesses = Self.bgChecker.guesses(forWordRange: range, in: skeleton, language: lang) ?? []
      for g in guesses.prefix(12) { consider(g) }
    }
    return out
  }

  /// Backspace immediately after an autocorrect restores the typed original
  /// (consuming the delete). kb.autocorrect.backspaceRevert kills it OTA.
  private func maybeRevertAutocorrectOnDelete() -> Bool {
    guard flagBool("kb.autocorrect.backspaceRevert", true),
          let last = lastAutocorrect,
          let proxy = host?.hostTextDocumentProxy else { return false }
    let ctx = proxy.documentContextBeforeInput ?? ""
    guard ctx.hasSuffix(last.corrected + last.boundary) else {
      lastAutocorrect = nil
      return false
    }
    replaceTail(count: last.corrected.count + last.boundary.count,
                with: last.original + last.boundary, proxy: proxy)
    // The sharpest quality signal we have: the user just backspaced a
    // correction, i.e. told us it was wrong.
    KeyboardTelemetry.bump(.autocorrectReverted)
    resetTypingContext(tailAtBoundary: true)
    updateAutoCap()
    return true
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
      case "hasSuggestions":       return .bool(!state.suggestions.isEmpty)
      case "flowArmed":            return .bool(state.flowArmed)
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
  /// Flow-session armed state (host-owned). Drives the mic key's
  /// "Start Flow" bolt vs the ready mic mark, so "tap opens the app to arm"
  /// is visually distinct from "tap to dictate".
  func reflectFlowArmed(_ armed: Bool) {
    if state.flowArmed == armed { return }
    state.flowArmed = armed
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
  private var lastFieldContextReadAt: TimeInterval = 0
  private var pendingFieldContextRefresh = false
  func reflectFieldContext() {
    // This fires from textDidChange — i.e. on EVERY keystroke — and each of
    // the three host reads below crosses into the host app (proxy traits /
    // textInputMode). The values only actually change on focus switches, so
    // throttle the reads; kb.host.traitRefreshMs=0 restores per-keystroke.
    // A throttled call is never DROPPED — it re-arms one deferred read, so a
    // fast field switch (type → tap another field < 500ms later) still lands
    // its return-key label a beat later instead of never.
    let minInterval = flagDouble("kb.host.traitRefreshMs", 500) / 1000.0
    let now = Date().timeIntervalSince1970
    if minInterval > 0, now - lastFieldContextReadAt < minInterval {
      if !pendingFieldContextRefresh {
        pendingFieldContextRefresh = true
        let delay = max(0.05, minInterval - (now - lastFieldContextReadAt))
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
          self?.pendingFieldContextRefresh = false
          self?.reflectFieldContext()
        }
      }
      return
    }
    lastFieldContextReadAt = now
    let rt = host?.hostReturnKeyType() ?? .default
    let lang = host?.hostPrimaryLanguageCode() ?? "EN"
    let multi = host?.hostNeedsInputModeSwitchKey() ?? false
    var changed = false
    if lastReflectedReturnKey != rt         { lastReflectedReturnKey = rt; changed = true }
    if state.primaryLanguage != lang        {
      state.primaryLanguage = lang
      cachedCheckerLang = nil   // autocorrect follows the active language
      changed = true
    }
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
