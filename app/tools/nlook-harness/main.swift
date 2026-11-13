// iOS Simulator snapshot harness for the nlook widget renderer.
//
// It compiles together with the widget target's OWN Swift files (same module, plus -DNLOOK_TEST_SEAM), so it plans and
// draws the shipping code rather than a copy of it. Not part of the app bundle: a workflow builds this file + the target
// sources into a throwaway simulator app, launches it with `--console`, and reads the MEASURE / CHECK / VERDICT lines.
// The PNGs land in the app's Documents folder for a human to look at.
//
// WHAT IT PROVES — H16-Q2, "a root's `bg` is the widget's own background, drawn the way the system draws that family's":
//
//   rect, circle   the root's `bg` leaves the drawn tree and comes back as the SYSTEM's accessory backdrop
//                  (`plan.backdrop`), so a design can never paint an opaque slab on the Lock Screen — square even in
//                  the circle slot — the way the first cut of this renderer did.
//   inline         nothing: no backdrop, no container.
//   small          the `bg` becomes the container background, which iOS drops in StandBy.
//   words          on an accessory root, and on a Home root in StandBy, the root's `bg` is NOT the nearest background,
//                  so an untinted Text takes `ink` and stays readable. The old code gave it `ground`: near-black words
//                  on a Lock Screen.
//
// Hard failures are the planning decisions and "the words actually drew pixels". The backdrop's own coverage is
// REPORTED, not asserted: `AccessoryWidgetBackground()` is drawn by WidgetKit, and in a plain host app it may come out
// as a flat material or as nothing at all. The PNGs are there for the eye that case needs.

// THIS FILE LIVES OUTSIDE THE TARGET, and must stay there. @bacons/apple-targets hands `app/targets/widgets/` to Xcode
// as one synchronized group, so every .swift under it is a source of the shipping extension — and Swift makes a file
// NAMED `main.swift` the module's top-level-code entry point whatever its contents, `#if` included. Beside
// `@main struct TailzuWidgetBundle` that is "'main' attribute cannot be used in a module that contains top-level code":
// the store build would not compile. The `NLOOK_TEST_SEAM` flag below, which only the harness build passes, is what
// keeps the store's test seam out of the shipping extension; it is not what keeps this file out.
#if NLOOK_TEST_SEAM

import SwiftUI
import UIKit
import WidgetKit

/// Line logger → stdout (unbuffered, so `simctl launch --console` streams it) and Documents/harness.log, which the
/// workflow can pull out of the app's data container even when console streaming yields nothing.
func log(_ s: String) {
  print(s)
  fflush(stdout)
  guard let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
  let u = dir.appendingPathComponent("harness.log")
  let data = (s + "\n").data(using: .utf8)!
  if FileManager.default.fileExists(atPath: u.path), let h = try? FileHandle(forWritingTo: u) {
    h.seekToEndOfFile()
    h.write(data)
    try? h.close()
  } else {
    try? data.write(to: u)
  }
}

// ---------------------------------------------------------------- the catalog under test

/// Black ground, white ink, so a word that took `ground` instead of `ink` would come out invisible and the pixel count
/// would say so.
let indexJSON = """
{
  "v": 1,
  "drawsFormat": 1,
  "palettes": {
    "test": {
      "dark": { "ground": "#000000", "ink": "#FFFFFF", "meta": "#BBBBBB", "line": "#444444",
                "surface": "#222222", "accent": "#FFCC00" },
      "light": { "ground": "#FFFFFF", "ink": "#000000", "meta": "#555555", "line": "#CCCCCC",
                 "surface": "#EEEEEE", "accent": "#AA6600" }
    }
  },
  "designs": { "test.backdrop": "test.backdrop.json" },
  "art": {},
  "fonts": {}
}
"""

/// One design, four roots, every one of them a `bg: "ink"` root holding a Text with no `tint` — the case H16-Q2 names.
let designJSON = """
{
  "id": "test.backdrop",
  "format": 1,
  "surface": "widget",
  "palette": "test",
  "roots": {
    "rect": { "type": "V", "style": { "bg": "ink", "pad": 6 },
              "children": [{ "type": "Text", "props": { "text": "Bots at work", "type": "body" } }] },
    "circle": { "type": "V", "style": { "bg": "ink", "pad": 4 },
                "children": [{ "type": "Text", "props": { "text": "7", "type": "display" } }] },
    "inline": { "type": "Text", "style": { "bg": "ink" }, "props": { "text": "Bots at work" } },
    "small": { "type": "V", "style": { "bg": "ink", "pad": 10 },
               "children": [{ "type": "Text", "props": { "text": "Bots at work", "type": "body" } }] }
  }
}
"""

// ---------------------------------------------------------------- measuring

struct Shot {
  /// Pixels the view drew anything at all on, as a fraction of the frame.
  var coverage: Double
  /// Pixels that are nearly opaque AND nearly white: the words, in `ink`.
  var words: Int
  /// Pixels that are nearly opaque: a filled slab shows up here, the system's translucent backdrop does not.
  var opaque: Double
}

/// Render a view at a size and count its pixels on a TRANSPARENT ground, so a translucent backdrop and an opaque fill
/// can be told apart. Also writes the PNG into Documents under `name`.
@MainActor
func shoot<V: View>(_ view: V, _ size: CGSize, _ name: String) -> Shot? {
  let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
  renderer.scale = 2
  guard let image = renderer.uiImage, let cg = image.cgImage else { return nil }

  if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
     let png = image.pngData() {
    try? png.write(to: dir.appendingPathComponent("\(name).png"))
  }

  let w = cg.width, h = cg.height
  var data = [UInt8](repeating: 0, count: w * h * 4)
  guard let ctx = CGContext(
    data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else { return nil }
  ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))

  var drawn = 0, words = 0, opaque = 0
  for i in stride(from: 0, to: w * h * 4, by: 4) {
    let a = Int(data[i + 3])
    if a > 8 { drawn += 1 }
    if a > 200 {
      opaque += 1
      // Premultiplied, so at this alpha the stored channels are the colour itself.
      if Int(data[i]) > 180, Int(data[i + 1]) > 180, Int(data[i + 2]) > 180 { words += 1 }
    }
  }
  let total = Double(max(1, w * h))
  return Shot(coverage: Double(drawn) / total, words: words, opaque: Double(opaque) / total)
}

/// Two Colors are the same colour, resolved in one appearance. SwiftUI's `==` compares how a Color was built, not what
/// it paints, so this resolves both through UIKit first.
@MainActor
func same(_ a: Color, _ b: Color) -> Bool {
  let traits = UITraitCollection(userInterfaceStyle: .dark)
  var ar: CGFloat = 0, ag: CGFloat = 0, ab: CGFloat = 0, aa: CGFloat = 0
  var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
  UIColor(a).resolvedColor(with: traits).getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
  UIColor(b).resolvedColor(with: traits).getRed(&br, green: &bg, blue: &bb, alpha: &ba)
  let close = { (x: CGFloat, y: CGFloat) in abs(x - y) < 0.01 }
  return close(ar, br) && close(ag, bg) && close(ab, bb) && close(aa, ba)
}

// ---------------------------------------------------------------- the run

@MainActor
final class Harness {
  private var fails: [String] = []

  private func check(_ name: String, _ passed: Bool, _ detail: String = "") {
    log("CHECK \(passed ? "ok  " : "FAIL") \(name)\(detail.isEmpty ? "" : " — \(detail)")")
    if !passed { fails.append(name) }
  }

  /// Plan one family the way X0View does, with no glance and no rows: the design is named by `overrideId`, as the X0
  /// Board kind names one.
  private func plan(_ family: WidgetFamily, standby: Bool = false) -> NLookPlanned? {
    let now = Date()
    let x0 = X0Context(g: nil, p: X0Palette.of(.dark), states: [:], now: now, rim: true)
    return NLookRoots.widget(
      kind: "x0", overrideId: "test.backdrop", glance: nil, states: [:], now: now, family: family,
      scheme: .dark, mode: .fullColor, reduced: false, standby: standby,
      displaySize: X0View.boxOf(family), displayScale: 2, x0: x0)
  }

  func run() {
    let ok = NLookStore.useForTests(
      index: Data(indexJSON.utf8),
      designs: ["test.backdrop": Data(designJSON.utf8)])
    check("the catalog parses", ok)
    guard ok else { return verdict() }

    // ------------------------------------------------- rect and circle: the backdrop, and readable words
    for (family, name) in [(WidgetFamily.accessoryRectangular, "rect"), (.accessoryCircular, "circle")] {
      guard let p = plan(family) else {
        check("\(name): planned", false, "no plan at all")
        continue
      }
      check("\(name): the system backdrop is asked for", p.backdrop)
      check("\(name): the root's bg left the drawn tree", p.node.style.bg == nil)
      check("\(name): no container background", p.containerBG == nil)
      check("\(name): the root's bg is not the nearest background", p.ctx.bgRole.isEmpty, "bgRole=\"\(p.ctx.bgRole)\"")
      check("\(name): an untinted Text takes ink", same(p.ctx.defaultTint, p.ctx.scheme.ink))

      guard let shot = shoot(NLookRootView(plan: p), X0View.boxOf(family), "nlook-\(name)") else {
        check("\(name): rendered", false, "ImageRenderer gave nothing")
        continue
      }
      log(String(
        format: "MEASURE %@ coverage=%.2f opaque=%.2f wordPixels=%d",
        name, shot.coverage, shot.opaque, shot.words))
      check("\(name): the words drew", shot.words > 20, "\(shot.words) near-white opaque pixels")
    }

    // ------------------------------------------------- inline: no backdrop, nothing behind the words
    if let p = plan(.accessoryInline) {
      check("inline: no backdrop", !p.backdrop)
      check("inline: no container background", p.containerBG == nil)
      check("inline: the root's bg left the drawn tree", p.node.style.bg == nil)
      _ = shoot(NLookRootView(plan: p), X0View.boxOf(.accessoryInline), "nlook-inline")
    } else {
      check("inline: planned", false, "no plan at all")
    }

    // ------------------------------------------------- small: the container holds the bg, StandBy drops the text rule
    if let p = plan(.systemSmall) {
      check("small: no backdrop", !p.backdrop)
      check("small: the bg became the container", p.containerBG.map { same($0, p.ctx.scheme.ink) } ?? false)
      check("small: the root's bg left the drawn tree", p.node.style.bg == nil)
      check("small: on a Home Screen the bg IS the nearest background", p.ctx.bgRole == "ink")
      check("small: an untinted Text takes ground there", same(p.ctx.defaultTint, p.ctx.scheme.ground))
      if let shot = shoot(NLookRootView(plan: p), X0View.boxOf(.systemSmall), "nlook-small") {
        log(String(format: "MEASURE small coverage=%.2f opaque=%.2f wordPixels=%d",
                   shot.coverage, shot.opaque, shot.words))
      }
    } else {
      check("small: planned", false, "no plan at all")
    }

    if let p = plan(.systemSmall, standby: true) {
      check("small in StandBy: the container is gone, so the bg is not the nearest", p.ctx.bgRole.isEmpty)
      check("small in StandBy: an untinted Text takes ink", same(p.ctx.defaultTint, p.ctx.scheme.ink))
    } else {
      check("small in StandBy: planned", false, "no plan at all")
    }

    verdict()
  }

  private func verdict() {
    if fails.isEmpty {
      log("VERDICT: PASS — every root's background is the widget's own, and every untinted word is readable")
    } else {
      for f in fails { log("VERDICT-FAIL: \(f)") }
      log("VERDICT: FAIL (\(fails.count))")
    }
    let code: Int32 = fails.isEmpty ? 0 : 2
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(code) }
  }
}

final class HarnessAppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    log("BOOT didFinishLaunching")
    // The safety net goes first, so a wedge in the run below still ends the process with a verdict.
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      log("VERDICT: FAIL — timed out before a verdict")
      exit(3)
    }
    let w = UIWindow(frame: UIScreen.main.bounds)
    w.rootViewController = UIViewController()
    w.makeKeyAndVisible()
    window = w
    // This method is already on the main actor, so the harness runs straight from here — no hop that would have to
    // claim main-actor isolation of its own.
    Harness().run()
    return true
  }
}

UIApplicationMain(
  CommandLine.argc, CommandLine.unsafeArgv, nil,
  NSStringFromClass(HarnessAppDelegate.self)
)

#endif
