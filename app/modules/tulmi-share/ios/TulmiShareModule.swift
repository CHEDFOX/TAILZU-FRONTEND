import ExpoModulesCore
import Foundation

/// The app's half of sharing into Tailzu on iPhone.
///
/// The share extension (targets/share/ShareViewController.swift) copies what
/// was shared into the App Group and writes the list under
/// "tulmi.share.pending", then opens tulmi://share. This takes the list ONCE:
/// it is cleared as it is read, its files are moved out of the App Group into
/// the app's own caches (where the uploader may read them, and nothing else
/// can), and the App Group's ShareIn folder is emptied.
///
/// Returns { items, skipped }, items being
///   { type: "text", text } | { type: "url", url } |
///   { type: "file", uri: "file://…", name, mime, bytes }
/// or an empty list when nothing is waiting, or it is older than `maxAgeMs`
/// (ten minutes when absent): a share is a moment, not a queue.
public class TulmiShareModule: Module {
  // Must match the App Group of the app, the keyboard and the share extension.
  private static let appGroup = "group.com.tulmi.app"
  private static let pendingKey = "tulmi.share.pending"
  private static let folder = "ShareIn"

  public func definition() -> ModuleDefinition {
    Name("TulmiShare")

    Function("consumeShared") { (maxAgeMs: Double?) -> [String: Any] in
      let d = UserDefaults(suiteName: TulmiShareModule.appGroup)
      let json = d?.string(forKey: TulmiShareModule.pendingKey) ?? ""
      d?.removeObject(forKey: TulmiShareModule.pendingKey)
      let fm = FileManager.default
      guard let container = fm.containerURL(forSecurityApplicationGroupIdentifier: TulmiShareModule.appGroup) else {
        return ["items": [], "skipped": 0]
      }
      let shared = container.appendingPathComponent(TulmiShareModule.folder, isDirectory: true)
      // Whatever happens below, the App Group keeps nothing that was shared.
      defer { try? fm.removeItem(at: shared) }
      guard !json.isEmpty,
            let data = json.data(using: .utf8),
            let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        return ["items": [], "skipped": 0]
      }
      var window: Double = 600_000
      if let m = maxAgeMs, m.isFinite, m > 0 { window = m }
      let at = (o["at"] as? Double) ?? 0
      if at <= 0 || Date().timeIntervalSince1970 * 1000 - at > window { return ["items": [], "skipped": 0] }

      let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("share-in", isDirectory: true)
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      var out: [[String: Any]] = []
      var skipped = (o["skipped"] as? Double).map { Int($0) } ?? 0
      for item in (o["items"] as? [[String: Any]]) ?? [] {
        switch item["type"] as? String {
        case "text":
          if let t = item["text"] as? String, !t.isEmpty { out.append(["type": "text", "text": String(t.prefix(6000))]) }
        case "url":
          if let u = item["url"] as? String, u.hasPrefix("http://") || u.hasPrefix("https://") { out.append(["type": "url", "url": String(u.prefix(2000))]) }
        case "file":
          // Only a file the extension put in ShareIn/: never a path that climbs out of it.
          guard let rel = item["path"] as? String, rel.hasPrefix(TulmiShareModule.folder + "/"), !rel.contains(".."),
                let name = item["name"] as? String, !name.isEmpty, !name.contains("/") else { skipped += 1; continue }
          let src = container.appendingPathComponent(rel)
          let dest = caches.appendingPathComponent(name)
          do {
            try fm.createDirectory(at: caches, withIntermediateDirectories: true)
            try fm.moveItem(at: src, to: dest)
          } catch {
            skipped += 1
            continue
          }
          out.append([
            "type": "file", "uri": dest.absoluteString, "name": name,
            "mime": (item["mime"] as? String) ?? "application/octet-stream",
            "bytes": (item["bytes"] as? Double) ?? 0,
          ])
        default:
          continue
        }
      }
      return ["items": out, "skipped": skipped]
    }
  }
}
