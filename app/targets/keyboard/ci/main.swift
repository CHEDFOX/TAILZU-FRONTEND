// iOS Simulator harness — runs the REAL keyboard MicParticleView on a booted
// simulator, drives the disperse → reassemble animation, and measures the
// rendered pixels frame-by-frame. Compiled together with the keyboard target's
// own Swift files (same module), so it exercises the shipping code, not a copy.
//
// It's NOT part of the app bundle — the keyboard-ios-sim workflow compiles this
// file + the target sources into a throwaway simulator app, launches it with
// --console, and reads the MEASURE / VERDICT lines this prints. That gives real
// runtime signal (the view actually renders and animates on iOS) without a
// device or an EAS build.
//
// Verdict logic: the particle cloud must (a) render (nonzero filled pixels at
// every sample), (b) burst OUTWARD during recording (mid-disperse spread >>
// seed spread), then (c) converge BACK when reassembling (post-reassemble
// spread collapses toward the seed). That's the whole "structure → particles →
// structure" contract, checked on real pixels.

import UIKit

/// Line logger → stdout (unbuffered, so `simctl launch --console` streams it)
/// AND appended to Documents/harness.log so the workflow can pull it from the
/// app's data container even if console streaming yields nothing.
func log(_ s: String) {
  print(s)
  fflush(stdout)
  guard let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
  let u = dir.appendingPathComponent("harness.log")
  let data = (s + "\n").data(using: .utf8)!
  if FileManager.default.fileExists(atPath: u.path), let h = try? FileHandle(forWritingTo: u) {
    h.seekToEndOfFile(); h.write(data); try? h.close()
  } else {
    try? data.write(to: u)
  }
}

/// Render `view` into an RGBA buffer on black and return (filledPixels, spread).
/// `spread` = RMS distance of filled pixels from their centroid (how spread out
/// the cloud is). Filled = luminance above a threshold (the bright dots vs the
/// black backdrop).
func measure(_ view: UIView) -> (count: Int, spread: Double) {
  let w = max(1, Int(view.bounds.width))
  let h = max(1, Int(view.bounds.height))
  var data = [UInt8](repeating: 0, count: w * h * 4)
  guard let ctx = CGContext(
    data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { return (0, 0) }
  ctx.setFillColor(UIColor.black.cgColor)
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  view.layer.render(in: ctx)

  var n = 0
  var sx = 0.0, sy = 0.0
  var pts: [(Double, Double)] = []
  for y in 0..<h {
    for x in 0..<w {
      let i = (y * w + x) * 4
      let lum = (Int(data[i]) + Int(data[i + 1]) + Int(data[i + 2])) / 3
      if lum > 40 {
        n += 1; sx += Double(x); sy += Double(y)
        pts.append((Double(x), Double(y)))
      }
    }
  }
  guard n > 0 else { return (0, 0) }
  let cx = sx / Double(n), cy = sy / Double(n)
  var sq = 0.0
  for (px, py) in pts { let dx = px - cx, dy = py - cy; sq += dx * dx + dy * dy }
  return (n, (sq / Double(n)).squareRoot())
}

/// Load the brand mark PNG bundled next to the executable (the workflow copies
/// TailzuMark's mark@2x.png in as tailzu_mark.png). Falls back to nil → the sim
/// seeds a random spread, which still exercises the physics.
func loadMark() -> UIImage? {
  if let p = Bundle.main.path(forResource: "tailzu_mark", ofType: "png") {
    return UIImage(contentsOfFile: p)
  }
  return nil
}

final class HarnessVC: UIViewController {
  private var particles: MicParticleView!
  private var seedSpread = 0.0
  private var disperseSpread = 0.0

  override func viewDidLoad() {
    super.viewDidLoad()
    log("viewDidLoad start bounds=\(view.bounds.width)x\(view.bounds.height)")
    view.backgroundColor = .black

    let side: CGFloat = 220
    let p = MicParticleView(count: 40, dotRadius: 2.5, color: .systemYellow, sourceImage: loadMark())
    p.frame = CGRect(x: (view.bounds.width - side) / 2, y: (view.bounds.height - side) / 2,
                     width: side, height: side)
    p.backgroundColor = .clear
    view.addSubview(p)
    particles = p

    // Timeline (CADisplayLink advances the physics between samples):
    //  0.15s → seed frame (structure just burst)
    //  1.20s → mid-disperse (should be spread out)
    //  1.25s → reassemble()
    //  2.40s → post-reassemble (should have collapsed back)
    after(0.15) { [self] in
      let m = measure(p); seedSpread = m.spread
      log("MEASURE seed count=\(m.count) spread=\(fmt(m.spread))")
    }
    after(1.20) { [self] in
      let m = measure(p); disperseSpread = m.spread
      log("MEASURE disperse count=\(m.count) spread=\(fmt(m.spread))")
    }
    after(1.25) { [self] in p.reassemble { log("reassemble complete") } }
    after(2.40) { [self] in
      let m = measure(p)
      log("MEASURE reassembled count=\(m.count) spread=\(fmt(m.spread))")
      verdict(reassembledCount: m.count, reassembledSpread: m.spread)
    }
  }

  private func verdict(reassembledCount: Int, reassembledSpread: Double) {
    var fails: [String] = []
    if seedSpread <= 0 || disperseSpread <= 0 || reassembledCount == 0 {
      fails.append("cloud did not render (a sample had 0 filled pixels)")
    }
    // Burst outward: mid-disperse noticeably wider than the seeded structure.
    if !(disperseSpread > seedSpread * 1.15) {
      fails.append("did not disperse (disperse \(fmt(disperseSpread)) !> seed \(fmt(seedSpread)) * 1.15)")
    }
    // Converge back: post-reassemble collapses well below the dispersed cloud.
    if !(reassembledSpread < disperseSpread * 0.85) {
      fails.append("did not reassemble (reassembled \(fmt(reassembledSpread)) !< disperse \(fmt(disperseSpread)) * 0.85)")
    }
    let pass = fails.isEmpty
    if pass {
      log("VERDICT: PASS — render + disperse + reassemble all confirmed on-simulator")
    } else {
      for f in fails { log("VERDICT-FAIL: \(f)") }
      log("VERDICT: FAIL")
    }
    // Stay alive briefly so the workflow's second screenshot catches the
    // reassembled frame before the process exits.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { exit(pass ? 0 : 2) }
  }

  private func fmt(_ d: Double) -> String { String(format: "%.1f", d) }
  private func after(_ s: Double, _ block: @escaping () -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: block)
  }
}

final class HarnessAppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    log("BOOT didFinishLaunching")
    // Schedule the safety net FIRST so it fires even if view setup below wedges.
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
      log("VERDICT: FAIL — timed out before verdict")
      exit(3)
    }
    let w = UIWindow(frame: UIScreen.main.bounds)
    w.rootViewController = HarnessVC()
    w.makeKeyAndVisible()
    window = w
    log("BOOT window visible")
    return true
  }
}

UIApplicationMain(
  CommandLine.argc, CommandLine.unsafeArgv, nil,
  NSStringFromClass(HarnessAppDelegate.self)
)
