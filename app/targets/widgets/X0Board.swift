import AppIntents
import SwiftUI
import WidgetKit

// "X0 BOARD": THE SPARE KIND.
//
// One more gallery entry whose contents are a CHOICE, not a build: the "Show" parameter's options come from a list the app
// writes into the App Group, and each option names an nlook design. So "Plan today" later becomes a new board in the
// catalog, not a new widget and not a new release.
//
// TWO THINGS THAT CANNOT BE UNDONE, and which is why this kind is on the device checklist rather than launched dark:
//   • A shipped widget kind can NEVER be removed. WidgetKit reads the bundle before the app has ever run, so no server
//     switch takes this entry out of the gallery. From install on it is there.
//   • It must never be empty (App Review 2.3.1). So: the bundled default board (`board.base`, "Overview") is always one of
//     the options, and with no board chosen, no catalog and no glance stored it draws X0's OWN native view for the size.
//     Placing it never forces a configure screen.
//
// Everything it draws is X0View's, with `kind` set: one renderer, one set of fallbacks, one place where a bad design is
// caught.

/// One board someone can pick.
struct BoardEntity: AppEntity, Identifiable {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "Board" }
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
  static var defaultQuery = BoardQuery()

  /// Compiled in, so there is always something to show: the bundled default board, and the name people see for it.
  static let bundled = BoardEntity(id: "board.base", name: "Overview")
}

/// The boards this phone can draw: whatever the app wrote, and always the bundled one.
struct BoardQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [BoardEntity] {
    X0Boards.all().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [BoardEntity] { X0Boards.all() }

  func defaultResult() -> BoardEntity? { X0Boards.all().first }
}

struct ChooseBoardIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Choose a board"
  static var description = IntentDescription("Pick what X0 Board shows.")

  @Parameter(title: "Show") var board: BoardEntity?

  init() {}
}

/// The list the app writes: [{ "id": "board.week", "name": "This week" }]. The bundled board leads it, and an id the phone
/// has no design for is still offered — X0's native view draws it, which is better than an option that vanishes.
enum X0Boards {
  static let key = "tulmi.widget.boards"

  static func all() -> [BoardEntity] {
    var out = [BoardEntity.bundled]
    guard let raw = WidgetAct.store?.string(forKey: key), !raw.isEmpty, let data = raw.data(using: .utf8),
          let rows = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return out }
    for row in rows.prefix(12) {
      guard let o = row as? [String: Any], let id = (o["id"] as? String).flatMap(NLookDesign.safeId),
            let name = o["name"] as? String, !name.isEmpty, id != BoardEntity.bundled.id,
            !out.contains(where: { $0.id == id }) else { continue }
      out.append(BoardEntity(id: id, name: String(name.prefix(40))))
    }
    return out
  }
}

struct X0BoardEntry: TimelineEntry {
  let entry: X0Entry
  let boardId: String

  var date: Date { entry.date }
}

struct X0BoardProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> X0BoardEntry {
    X0BoardEntry(
      entry: X0Entry(date: Date(), glance: X0Glance.sample, states: [:]), boardId: BoardEntity.bundled.id)
  }

  func snapshot(for configuration: ChooseBoardIntent, in context: Context) async -> X0BoardEntry {
    NLookStore.checkMarker()
    let g = X0Glance.load()
    let now = Date()
    let shown = g ?? (context.isPreview ? X0Glance.sample : nil)
    return X0BoardEntry(
      entry: X0Entry(date: now, glance: shown?.asOf(now), states: NowStates.all(since: g?.outcomesSince ?? 0)),
      boardId: configuration.board?.id ?? BoardEntity.bundled.id)
  }

  func timeline(for configuration: ChooseBoardIntent, in context: Context) async -> Timeline<X0BoardEntry> {
    // A board shows the same data the X0 widget shows, so it keeps the same rhythm: the glance's own refresh, and an entry
    // at each of its steps so a line takes over on time without a new glance.
    NLookStore.checkMarker()
    let g = X0Glance.load()
    let states = NowStates.all(since: g?.outcomesSince ?? 0)
    let start = Date()
    let span = g?.refreshAfterSec ?? 3600
    let board = configuration.board?.id ?? BoardEntity.bundled.id
    let dates = ([start] + (g?.stepDates(after: start, within: 86_400) ?? [])).sorted()
    let entries = dates.map { d in
      X0BoardEntry(entry: X0Entry(date: d, glance: g?.asOf(d), states: states), boardId: board)
    }
    return Timeline(entries: entries, policy: .after(start.addingTimeInterval(span)))
  }
}

struct X0BoardWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: WidgetKinds.board, intent: ChooseBoardIntent.self, provider: X0BoardProvider()) {
      entry in
      X0View(entry: entry.entry, kind: WidgetKinds.board, boardId: entry.boardId)
    }
    // Gallery metadata, read before the app has ever run: compile-time literals, and every line has to stay true in every
    // state — while looks are dark, before sign-in, and after new boards arrive.
    .configurationDisplayName("X0 Board")
    .description("A board you choose. It starts with what needs you and who's working.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}
