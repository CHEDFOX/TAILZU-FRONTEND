import Foundation
import WidgetKit

// WRITING SERVER DESIGNS WHERE THE WIDGETS AND THE LIVE ACTIVITY CAN READ THEM.
//
// The widget extension has no network at all, so everything it draws must already be a file in the App Group. This is the
// only thing that puts files there, and it does it in the one order that is safe while a widget may be drawing:
//
//   1. write the whole new version into a NEW folder (nlook/v<N>), which nothing is reading;
//   2. write the pointer to a temp file and RENAME it over nlook/current, which is atomic for a FILE on both platforms
//      (renaming a directory over a non-empty directory is not, which is why the folder is never renamed);
//   3. only then reload the timelines, so the first redraw already sees the new designs.
//
// Art and fonts are kept BY CONTENT (nlook/art/<sha>@<scale>.png), so a new sha is a new file and nothing a current index or
// a running Activity is reading is ever overwritten. Old version folders are swept on the next write.
//
// Everything is checked again here even though the app checked it first: these are files, and a file can be anything.
// Files take the default data-protection class (complete until first unlock), never `.complete`, so a Lock Screen widget and
// a Live Activity can still read them while the phone is locked.

enum TulmiNativeLooks {
  /// The App Group the widgets, the keyboard and the Live Activity all read. Must match the app's entitlements.
  static let appGroupName = "group.com.tulmi.app"
  private static let appGroup = appGroupName
  /// PNG, and nothing else, is ever drawn.
  private static let pngMagic: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

  private static var root: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("nlook", isDirectory: true)
  }

  /// A name that will become a file name: [a-z0-9._-@], no climbing out of its folder.
  private static func safeName(_ name: String) -> String? {
    let ok = Set("abcdefghijklmnopqrstuvwxyz0123456789._-@")
    guard (1...80).contains(name.count), name.lowercased().allSatisfy({ ok.contains($0) }),
          !name.contains(".."), !name.hasPrefix(".") else { return nil }
    return name
  }

  /// A DESIGN ID, exactly as the contract spells it (NLOOK_LIMITS.idPattern, `^[a-z0-9._-]{1,40}$`). A non-matching id is
  /// REFUSED, never repaired: lowercasing an id would store the design under a name the glance never asks for, so it
  /// would sit on disk and never draw. Both bridges keep this rule, so one catalog lands the same way on both platforms.
  private static func designId(_ id: String) -> String? {
    let ok = Set("abcdefghijklmnopqrstuvwxyz0123456789._-")
    guard (1...40).contains(id.count), id.allSatisfy({ ok.contains($0) }),
          !id.contains(".."), !id.hasPrefix(".") else { return nil }
    return id
  }

  private static func ensure(_ dir: URL) throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: nil)
  }

  /// Written with the default protection class, so a locked phone can still read it.
  private static func write(_ data: Data, to url: URL) throws {
    try data.write(to: url, options: [.atomic])
    try? FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
  }

  // ---------------------------------------------------------------- the catalog

  /// `{ "index": { … }, "designs": { "<id>": { … } } }`, as the app's own clean left it.
  /// Returns the version folder it wrote, or "" when nothing was written (and nothing was changed either).
  @discardableResult
  static func setLooks(_ json: String) -> String {
    guard let root,
          let data = json.data(using: .utf8), data.count <= 512 * 1024,
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let index = o["index"] as? [String: Any],
          let designs = o["designs"] as? [String: Any], !designs.isEmpty else { return "" }

    // A local counter, not the catalog's `v`: two catalogs with the same `v` must still land in different folders.
    let store = UserDefaults(suiteName: appGroup)
    let next = (store?.integer(forKey: "tulmi.nlook.folder") ?? 0) + 1
    let folder = "v\(next)"
    let dir = root.appendingPathComponent(folder, isDirectory: true)

    do {
      try ensure(dir)
      var written: [String: String] = [:]
      for (id, design) in designs {
        guard let id = designId(id),
              let body = try? JSONSerialization.data(withJSONObject: design), body.count <= 64 * 1024 else { continue }
        let file = id + ".json"
        try write(body, to: dir.appendingPathComponent(file))
        written[id] = file
      }
      // Not one design landed: leave the pointer, and this folder, exactly as they were. A catalog whose ids were all
      // refused must not become the version this phone holds.
      guard !written.isEmpty else {
        try? FileManager.default.removeItem(at: dir)
        return ""
      }

      // The index the widgets read: whatever the app sent, with the design-to-file map this write actually produced. The
      // app's own `designs` map is ignored outright, so a design that failed to write is never pointed at.
      var out = index
      out["designs"] = written
      let indexData = try JSONSerialization.data(withJSONObject: out)
      try write(indexData, to: dir.appendingPathComponent("index.json"))

      // The pointer last, and only as a rename, so a widget drawing right now either sees the old folder whole or the new
      // one whole, never half of either.
      let pointer = root.appendingPathComponent("current")
      let temp = root.appendingPathComponent("current.\(next).tmp")
      try write(Data(folder.utf8), to: temp)
      _ = try? FileManager.default.replaceItemAt(pointer, withItemAt: temp)
      if !FileManager.default.fileExists(atPath: pointer.path) {
        try FileManager.default.moveItem(at: temp, to: pointer)
      }
      store?.set(next, forKey: "tulmi.nlook.folder")
      sweep(keeping: folder)
      reload()
      return folder
    } catch {
      // A failed write leaves the pointer where it was, so the last good version keeps drawing.
      try? FileManager.default.removeItem(at: dir)
      return ""
    }
  }

  /// Old version folders go once the new one is pointed at. Art and fonts are kept by content and swept by the app.
  private static func sweep(keeping folder: String) {
    guard let root, let found = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return }
    for name in found {
      guard name.hasPrefix("v"), name != folder, Int(name.dropFirst()) != nil else { continue }
      try? FileManager.default.removeItem(at: root.appendingPathComponent(name))
    }
  }

  // ---------------------------------------------------------------- art and fonts

  /// One art file, moved in by content hash. The caller already checked the sha; this checks the shape of the file itself.
  @discardableResult
  static func writeArt(sha: String, scale: Int, from path: String) -> Bool {
    guard let root, let sha = safeName(sha.lowercased()), sha.count == 64,
          (1...3).contains(scale) else { return false }
    let source = URL(fileURLWithPath: path)
    guard let data = try? Data(contentsOf: source), data.count <= 512 * 1024, data.count > 8 else { return false }
    guard Array(data.prefix(8)) == pngMagic else { return false }
    let dir = root.appendingPathComponent("art", isDirectory: true)
    guard (try? ensure(dir)) != nil else { return false }
    let file = dir.appendingPathComponent("\(sha)@\(scale).png")
    // By content: the same sha is the same bytes, so a second write is simply unnecessary.
    if FileManager.default.fileExists(atPath: file.path) { return true }
    guard (try? write(data, to: file)) != nil else { return false }
    return true
  }

  /// One hooked font. TTF or OTF, at most 300 KB, kept by content like art.
  @discardableResult
  static func writeFont(sha: String, from path: String) -> Bool {
    guard let root, let sha = safeName(sha.lowercased()), sha.count == 64 else { return false }
    let source = URL(fileURLWithPath: path)
    let ext = source.pathExtension.lowercased()
    guard ext == "ttf" || ext == "otf" else { return false }
    guard let data = try? Data(contentsOf: source), data.count <= 300 * 1024, data.count > 64 else { return false }
    let dir = root.appendingPathComponent("fonts", isDirectory: true)
    guard (try? ensure(dir)) != nil else { return false }
    let file = dir.appendingPathComponent("\(sha).\(ext)")
    if FileManager.default.fileExists(atPath: file.path) { return true }
    guard (try? write(data, to: file)) != nil else { return false }
    return true
  }

  // ---------------------------------------------------------------- what the widgets said back

  /// Design ids a widget's crash marker struck twice. The app reports them so the server stops naming them for this phone.
  static func badDesigns() -> [String] {
    (UserDefaults(suiteName: appGroup)?.array(forKey: "tulmi.nlook.bad") as? [String]) ?? []
  }

  /// Cleared once the app has reported them, so the same ids are not sent again every launch.
  static func clearBadDesigns() {
    let store = UserDefaults(suiteName: appGroup)
    store?.removeObject(forKey: "tulmi.nlook.bad")
    store?.removeObject(forKey: "tulmi.nlook.strikes")
  }

  /// The catalog version this phone holds, so the app can send `nl` with the glance without re-reading the files.
  static func heldVersion() -> Int {
    guard let root,
          let pointer = try? String(contentsOf: root.appendingPathComponent("current"), encoding: .utf8),
          let folder = safeName(pointer.trimmingCharacters(in: .whitespacesAndNewlines)),
          let data = try? Data(contentsOf: root.appendingPathComponent(folder).appendingPathComponent("index.json")),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let v = o["v"] as? NSNumber else { return 0 }
    return v.intValue
  }

  private static func reload() {
    WidgetCenter.shared.reloadAllTimelines()
  }
}
