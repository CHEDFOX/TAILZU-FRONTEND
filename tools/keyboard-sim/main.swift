// kbsim <label> <outdir> — run every scenario against the generated build.
import Foundation

let args = CommandLine.arguments
let label = args.count > 1 ? args[1] : "build"
let outDir = args.count > 2 ? args[2] : "."
var report = ""
func say(_ s: String = "") { print(s); report += s + "\n" }
func pad(_ s: String, _ n: Int) -> String { s.count >= n ? s : s + String(repeating: " ", count: n - s.count) }
func lpad(_ s: String, _ n: Int) -> String { s.count >= n ? s : String(repeating: " ", count: n - s.count) + s }
func f1(_ x: Double) -> String { x.isNaN ? "-" : String(format: "%.1f", x) }
var json: [String: Any] = ["build": label]

let corpus = [
  "the quick brown fox jumps over the lazy dog.",
  "i will be there in ten minutes so wait for me.",
  "can you send me the file before the meeting starts.",
  "we should grab lunch at the new place near the office.",
  "thanks for the help yesterday it really made a difference.",
  "please call me back when you get a chance.",
  "the weather is great today lets go for a walk.",
  "i think the build is ready to test on my phone.",
  "see you at seven and bring the charger.",
  "she said the train was late again this morning.",
  "our flight lands at noon so we can meet at the hotel.",
  "just finished the report and sent it to everyone.",
]

say("TAILZU KEYBOARD SIMULATION — \(label)")
say("Keyboard \(Int(KB_WIDTH))x\(Int(KB_HEIGHT))pt, English letters, dark, backend flags from config.json.")
say("")

// MARK: 1. Coverage — one tap at every point of the keyboard

do {
  let s = Session()
  let W = Int(KB_WIDTH), H = Int(KB_HEIGHT)
  var grid = [[String]](repeating: [String](repeating: "", count: W), count: H)
  var t = 1.0
  var id = 0
  for y in 0..<H {
    for x in 0..<W {
      s.proxy.reset(); s.r.sideEffects = []; s.r.state.shift = false; s.r.state.capsLock = false
      let p = CGPoint(x: Double(x) + 0.5, y: Double(y) + 0.5)
      s.play([TimedEv(t: t, id: id, seq: 0, ev: .down(p)), TimedEv(t: t + 0.08, id: id, seq: 1, ev: .up(p))])
      id += 1; t += 1
      grid[y][x] = !s.proxy.text.isEmpty ? s.proxy.text : (s.r.sideEffects.first ?? "∅")
    }
  }
  // The key block: from halfway between the tools row and the top letter row
  // to the bottom edge. Inside it every point should type the nearest key.
  let q = s.center("q"), toolsBottom = s.m.window.convert(s.m.named["mic"]!.bounds, from: s.m.named["mic"]!).maxY
  let blockTop = (toolsBottom + q.minY) / 2
  var dead = 0, wrong = 0, total = 0, toolsTyped = 0, toolsArea = 0
  var wrongSamples: [String: Int] = [:]
  var mis = [[Bool]](repeating: [Bool](repeating: false, count: W), count: H)
  for y in 0..<H {
    for x in 0..<W {
      let p = CGPoint(x: Double(x) + 0.5, y: Double(y) + 0.5)
      let got = grid[y][x]
      if p.y < blockTop {
        toolsArea += 1
        if got.count == 1, got != " " { toolsTyped += 1 }
        continue
      }
      total += 1
      let want = nearestKey(p, s)
      if got == "∅" { dead += 1; mis[y][x] = true }
      else if got != want { wrong += 1; mis[y][x] = true; wrongSamples["\(want)→\(got)", default: 0] += 1 }
    }
  }
  say("1. COVERAGE — a tap at every point (\(W * H) taps)")
  say("   Key block (\(total) points, from y=\(Int(blockTop)) down):")
  say("     dead (types nothing):          \(dead)")
  say("     types a key that is not the nearest: \(wrong)")
  if !wrongSamples.isEmpty {
    let top = wrongSamples.sorted { $0.value > $1.value }.prefix(8)
      .map { "\($0.key.replacingOccurrences(of: " ", with: "␣").replacingOccurrences(of: "\n", with: "⏎")) \($0.value)pt²" }
    say("     largest: " + top.joined(separator: ", "))
  }
  say("   Tools strip above the keys: \(toolsTyped) of \(toolsArea) points type a letter.")
  say("")
  json["coverage"] = ["dead": dead, "wrong": wrong, "total": total, "toolsTyped": toolsTyped, "toolsArea": toolsArea]

  // The map, 3x, as a PPM for the report.
  let S = 3
  var img = [UInt8](repeating: 0, count: W * S * H * S * 3)
  func colour(_ l: String) -> (UInt8, UInt8, UInt8) {
    switch l {
    case "∅": return (255, 40, 40)
    case " ": return (200, 200, 205)
    case "\n": return (70, 120, 220)
    case "delete": return (120, 40, 50)
    case "shift": return (140, 90, 200)
    case "123": return (40, 150, 150)
    case "globe": return (60, 160, 90)
    case "mic": return (232, 162, 60)
    case "tone": return (190, 120, 60)
    default:
      var h: UInt32 = 2166136261
      for u in l.unicodeScalars { h = (h ^ u.value) &* 16777619 }
      let palette: [(UInt8, UInt8, UInt8)] = [(94, 129, 172), (136, 192, 208), (163, 190, 140), (235, 203, 139),
        (208, 135, 112), (180, 142, 173), (143, 188, 187), (129, 161, 193), (191, 97, 106), (216, 222, 233)]
      let c = palette[Int(h % UInt32(palette.count))]
      return c
    }
  }
  var keyRects: [CGRect] = []
  for (_, b) in s.m.allKeys { keyRects.append(s.m.window.convert(b.bounds, from: b)) }
  for y in 0..<(H * S) {
    for x in 0..<(W * S) {
      let gx = x / S, gy = y / S
      var c = colour(grid[gy][gx])
      if mis[gy][gx], grid[gy][gx] != "∅", (x + y) % 6 < 2 { c = (20, 20, 20) }
      let px = CGFloat(x) / CGFloat(S), py = CGFloat(y) / CGFloat(S)
      for r in keyRects {
        let onEdge = (abs(px - r.minX) < 0.34 || abs(px - r.maxX) < 0.34) && py >= r.minY && py <= r.maxY
          || (abs(py - r.minY) < 0.34 || abs(py - r.maxY) < 0.34) && px >= r.minX && px <= r.maxX
        if onEdge { c = (255, 255, 255) }
      }
      let o = (y * W * S + x) * 3
      img[o] = c.0; img[o + 1] = c.1; img[o + 2] = c.2
    }
  }
  var ppm = Data("P6\n\(W * S) \(H * S)\n255\n".utf8)
  ppm.append(contentsOf: img)
  try? ppm.write(to: URL(fileURLWithPath: "\(outDir)/coverage.ppm"))
}

// MARK: 2. Fast typing — every touch on its key; only the keyboard can err

func typingRun(_ typist: Typist, seeds: ClosedRange<UInt64>) -> [String: Any] {
  var chars = 0, errs = 0, aimErrs = 0, sentencesBad = 0, sentences = 0
  var cls = (swaps: 0, spaceSwaps: 0, drops: 0, extras: 0, subs: 0)
  var latLetter: [Double] = [], latSpace: [Double] = []
  var example: (want: String, got: String)?
  for seed in seeds {
    var rng = RNG(seed)
    for text in corpus {
      let s = Session()
      let presses = typist.plan(text, on: s, rng: &rng)
      s.play(events(presses))
      let ideal = idealText(presses, s)
      let got = s.proxy.text
      sentences += 1
      chars += ideal.count
      let e = levenshtein(Array(ideal), Array(got))
      errs += e
      aimErrs += levenshtein(Array(text), Array(ideal))
      if e > 0 {
        sentencesBad += 1
        let c = classify(ideal, got)
        cls.swaps += c.swaps; cls.spaceSwaps += c.spaceSwaps; cls.drops += c.drops
        cls.extras += c.extras; cls.subs += c.subs
        if example == nil { example = (ideal, got) }
      }
      for l in latencies(presses, s.proxy) {
        if l.char == " " { latSpace.append(l.ms) } else if l.char != "\n" { latLetter.append(l.ms) }
      }
    }
  }
  return ["chars": chars, "errors": errs, "aimErrors": aimErrs, "sentences": sentences, "sentencesBad": sentencesBad,
          "swaps": cls.swaps, "spaceSwaps": cls.spaceSwaps, "drops": cls.drops, "extras": cls.extras, "subs": cls.subs,
          "letterP50": percentile(latLetter, 0.5), "letterP95": percentile(latLetter, 0.95),
          "spaceP50": percentile(latSpace, 0.5), "spaceP95": percentile(latSpace, 0.95),
          "exampleWant": example?.want ?? "", "exampleGot": example?.got ?? ""]
}

say("2. FAST TYPING — two thumbs, every touch lands on its key (\(corpus.count) sentences x 8 seeds per speed)")
say("   Errors are the keyboard's alone: output vs what a perfect keyboard types for the same touches.")
say("   " + pad("wpm", 5) + lpad("chars", 7) + lpad("errors", 8) + lpad("bad sent.", 11) + lpad("swaps", 7)
    + lpad("space", 7) + lpad("drops", 7) + lpad("extra", 7) + lpad("letter ms", 13) + lpad("space ms", 13))
var fast: [[String: Any]] = []
for wpm in [40.0, 60.0, 80.0, 100.0, 120.0] {
  let r = typingRun(Typist(wpm: wpm), seeds: 1...8)
  fast.append(["wpm": wpm].merging(r) { a, _ in a })
  say("   " + pad(String(Int(wpm)), 5) + lpad("\(r["chars"]!)", 7) + lpad("\(r["errors"]!)", 8)
      + lpad("\(r["sentencesBad"]!)/\(r["sentences"]!)", 11) + lpad("\(r["swaps"]!)", 7) + lpad("\(r["spaceSwaps"]!)", 7)
      + lpad("\(r["drops"]!)", 7) + lpad("\(r["extras"]!)", 7)
      + lpad(f1(r["letterP50"] as! Double) + " / " + f1(r["letterP95"] as! Double), 13)
      + lpad(f1(r["spaceP50"] as! Double) + " / " + f1(r["spaceP95"] as! Double), 13))
}
if let worst = fast.last, let w = worst["exampleWant"] as? String, !w.isEmpty {
  say("   e.g. at 120 wpm  wanted: \(w)")
  say("                       got: \(worst["exampleGot"] as! String)")
}
say("   ms columns: finger-down to character on screen, median/95th percentile.")
say("")
json["fastTyping"] = fast

// MARK: 3. Real thumbs — aim spread over gaps and edges, with the bigram bias

say("3. REAL THUMB AIM — touch spread careful ±5/±6pt, sloppy ±9/±10pt (x/y, one sd), 2pt low, 80 wpm")
say("   " + pad("config", 30) + lpad("CER vs meant", 14) + lpad("keyboard-caused", 17))
var aim: [[String: Any]] = []
let savedBias = (FLAG_BOOL["kb.touch.lmBias.enabled"], FLAG_NUM["kb.touch.lmBias.pt"])
for (name, on, pt, sx, sy) in [("careful, nearest key", false, 0.0, 5.0, 6.0), ("careful, bigram bias 6pt", true, 6.0, 5.0, 6.0),
                                ("sloppy, nearest key", false, 0.0, 9.0, 10.0), ("sloppy, bigram bias 6pt", true, 6.0, 9.0, 10.0)] {
  FLAG_BOOL["kb.touch.lmBias.enabled"] = on
  FLAG_NUM["kb.touch.lmBias.pt"] = pt
  var t = Typist(wpm: 80); t.aimSD = (sx, sy); t.aimBiasY = 2; t.clampInKey = false
  var chars = 0, errMeant = 0, errKb = 0
  for seed in UInt64(101)...UInt64(108) {
    var rng = RNG(seed)
    for text in corpus {
      let s = Session()
      let presses = t.plan(text, on: s, rng: &rng)
      s.play(events(presses))
      chars += text.count
      errMeant += levenshtein(Array(text), Array(s.proxy.text))
      if !on { errKb += levenshtein(Array(idealText(presses, s)), Array(s.proxy.text)) }
    }
  }
  let cer = 100 * Double(errMeant) / Double(chars)
  aim.append(["config": name, "cer": cer, "keyboardErrors": errKb, "chars": chars])
  say("   " + pad(name, 30) + lpad(String(format: "%.2f%%", cer), 14) + lpad(on ? "-" : "\(errKb)", 17))
}
FLAG_BOOL["kb.touch.lmBias.enabled"] = savedBias.0
FLAG_NUM["kb.touch.lmBias.pt"] = savedBias.1
say("   CER: characters wrong per hundred typed, against the sentence meant.")
say("")
json["aim"] = aim

// MARK: 4. Edge cases, one at a time

struct Step { let t: Double; let ev: TouchEv; let id: Int }
func run(_ steps: [Step], setup: ((Session) -> Void)? = nil) -> (String, Session) {
  let s = Session()
  setup?(s)
  var seq = 0
  s.play(steps.map { st in defer { seq += 1 }; return TimedEv(t: st.t, id: st.id, seq: seq, ev: st.ev) })
  return (s.proxy.text, s)
}
func tap(_ s: Session, _ k: String, at t: Double, hold: Double = 0.08, id: Int, dx: CGFloat = 0, dy: CGFloat = 0,
         liftDX: CGFloat = 0, liftDY: CGFloat = 0, cancel: Bool = false) -> [Step] {
  let r = s.center(k)
  let p = CGPoint(x: r.midX + dx, y: r.midY + dy)
  let q = CGPoint(x: p.x + liftDX, y: p.y + liftDY)
  var out = [Step(t: t, ev: .down(p), id: id)]
  var u = t + 0.016
  while u < t + hold { let a = (u - t) / hold
    out.append(Step(t: u, ev: .move(CGPoint(x: p.x + (q.x - p.x) * a, y: p.y + (q.y - p.y) * a)), id: id)); u += 0.016 }
  out.append(Step(t: t + hold, ev: cancel ? .cancel : .up(q), id: id))
  return out
}
let probe = Session()
var cases: [(String, String, String)] = []   // name, expected, got
func check(_ name: String, _ want: String, _ got: String) { cases.append((name, want, got)) }

// Space held while the other thumb lands the next letter.
do {
  var st: [Step] = []
  var t = 0.2, id = 0
  for c in "hello" { st += tap(probe, String(c), at: t, id: id); t += 0.1; id += 1 }
  st += tap(probe, " ", at: t, hold: 0.11, id: id); id += 1
  t += 0.06
  for c in "world" { st += tap(probe, String(c), at: t, id: id); t += 0.1; id += 1 }
  check("next letter lands while space is still held", "hello world", run(st).0)
}
do {
  var st: [Step] = []
  st += tap(probe, "a", at: 0.2, id: 0)
  st += tap(probe, "\n", at: 0.35, hold: 0.12, id: 1)
  st += tap(probe, "b", at: 0.42, id: 2)
  check("next letter lands while return is still held", "a\nb", run(st).0)
}
do {
  var st = tap(probe, "e", at: 0.2, hold: 0.65, id: 0)
  st += tap(probe, "t", at: 1.0, id: 1)
  check("hold e past the tray delay, release on the key", "et", run(st).0)
}
do {
  let r = probe.center("e")
  let chip2 = CGPoint(x: r.midX, y: r.midY - 52 - 0)   // the tray sits 52pt above; slide to the 2nd chip
  let (text, s) = run([], setup: nil)
  _ = text; _ = s
  let s2 = Session()
  let tray0 = CGPoint(x: r.midX, y: r.midY)
  var st: [Step] = [Step(t: 0.2, ev: .down(tray0), id: 0)]
  var t = 0.216
  while t < 0.75 { st.append(Step(t: t, ev: .move(tray0), id: 0)); t += 0.016 }
  // After the tray opens, find the 2nd chip in the live tray and slide there.
  s2.play(st.map { TimedEv(t: $0.t, id: $0.id, seq: 0, ev: $0.ev) })
  var got = "(no tray)"
  if let tray = s2.r.activeAccentTray, tray.subviews.count > 1 {
    let chip = tray.subviews[2]
    let c = s2.m.window.convert(CGPoint(x: chip.bounds.midX, y: chip.bounds.midY), from: chip)
    s2.play([TimedEv(t: 0.8, id: 0, seq: 1, ev: .move(c)), TimedEv(t: 0.85, id: 0, seq: 2, ev: .up(c))])
    got = s2.proxy.text
  }
  _ = chip2
  check("hold e, slide to the accent é, release", "é", got)
}
do {
  var st = tap(probe, "h", at: 0.2, hold: 0.25, id: 0, dx: 0, dy: 0)
  st = tap(probe, "shift", at: 0.2, hold: 0.25, id: 0) + tap(probe, "h", at: 0.3, id: 1) + tap(probe, "i", at: 0.6, id: 2)
  check("shift held while the other thumb types", "Hi", run(st).0)
}
do {
  let st = tap(probe, "a", at: 0.2, id: 0) + tap(probe, " ", at: 0.4, id: 1) + tap(probe, " ", at: 0.6, id: 2)
  check("double space makes a full stop", "a. ", run(st).0)
}
do {
  let st = tap(probe, "a", at: 0.2, id: 0) + tap(probe, " ", at: 0.4, hold: 0.5, id: 1)
  check("space held for the trackpad types no space", "a", run(st).0)
}
do {
  let st = tap(probe, "a", at: 0.2, id: 0) + tap(probe, " ", at: 0.4, hold: 0.09, id: 1, cancel: true)
    + tap(probe, "b", at: 0.6, id: 2)
  check("iOS cancels a quick space tap", "a b", run(st).0)
}
do {
  let st = tap(probe, "a", at: 0.2, id: 0) + tap(probe, " ", at: 0.4, hold: 0.09, id: 1, liftDY: 30)
    + tap(probe, "b", at: 0.6, id: 2)
  check("space lifted 30pt below the key", "a b", run(st).0)
}
do {
  let st = tap(probe, "o", at: 0.2, hold: 0.09, id: 0, cancel: true) + tap(probe, "k", at: 0.4, id: 1)
  check("iOS cancels a quick letter tap", "ok", run(st).0)
}
do {
  let st = tap(probe, "l", at: 0.2, hold: 0.07, id: 0) + tap(probe, "l", at: 0.305, hold: 0.07, id: 1)
  check("same key twice, fast", "ll", run(st).0)
}

say("4. EDGE CASES")
var passed = 0
for (n, w, g) in cases {
  let ok = w == g
  if ok { passed += 1 }
  let show = { (x: String) in "\"" + x.replacingOccurrences(of: "\n", with: "⏎") + "\"" }
  say("   " + (ok ? "PASS " : "FAIL ") + pad(n, 48) + (ok ? "" : "  wanted \(show(w)), got \(show(g))"))
}
say("   \(passed) of \(cases.count) pass")
json["edge"] = cases.map { ["name": $0.0, "want": $0.1, "got": $0.2, "pass": $0.1 == $0.2] }
say("")
say("Telemetry counters from the last session: " + KeyboardTelemetry.counts.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " "))

try? report.write(toFile: "\(outDir)/report.txt", atomically: true, encoding: .utf8)
if let d = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]) {
  try? d.write(to: URL(fileURLWithPath: "\(outDir)/results.json"))
}

// KBSIM_STRICT=1 (CI): any keyboard-caused typing error, dead point or failed
// edge case fails the run.
if ProcessInfo.processInfo.environment["KBSIM_STRICT"] == "1" {
  let fastErrors = fast.reduce(0) { $0 + ($1["errors"] as? Int ?? 0) }
  let dead = (json["coverage"] as? [String: Any])?["dead"] as? Int ?? 0
  let failedEdges = cases.filter { $0.1 != $0.2 }.count
  if fastErrors + dead + failedEdges > 0 {
    print("STRICT: \(fastErrors) typing errors, \(dead) dead points, \(failedEdges) failed edge cases")
    exit(1)
  }
}
