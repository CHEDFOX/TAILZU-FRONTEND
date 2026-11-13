import ActivityKit
import SwiftUI
import WidgetKit

// PUTTING A DESIGN ON A SURFACE: which root a family or a region asks for, and the one place that decides whether a server
// design draws at all.
//
// The rule is the same everywhere: a design draws only when the glance (or the push) NAMES it, the phone HOLDS it, it has a
// tree for THIS root, and it has not been marked bad. Anything else and the caller draws today's hand-written view — the
// whole view on a widget, one region at a time on the Live Activity.
//
// Launch dark needs nothing here. The server names no design until its switch is turned on, so a build that ships before the
// owner's device checks pass draws exactly what it drew before.

/// A design, a root of it, and everything that root needs to draw.
struct NLookPlanned {
  let designId: String
  let node: NLookNode
  let ctx: NLookCtx
  /// A Home Screen root's background, taken out of the tree and handed to `.containerBackground` instead. A root that
  /// names no `bg` draws as if it said `bg: "ground"`, so this is set on every Home Screen root. nil on accessory roots
  /// and on the Live Activity.
  var containerBG: Color?
  /// The system's own Lock Screen backdrop goes behind the tree: set when a `rect` or `circle` root named a `bg`. The
  /// colour it named is not used — the Lock Screen draws accessories by brightness, and the backdrop is the only
  /// background that family has.
  var backdrop = false
}

enum NLookRoots {
  /// The root name a widget family asks for.
  static func name(_ family: WidgetFamily) -> String {
    switch family {
    case .systemSmall: return "small"
    case .systemMedium: return "medium"
    case .systemLarge: return "large"
    case .accessoryInline: return "inline"
    case .accessoryRectangular: return "rect"
    case .accessoryCircular: return "circle"
    default: return "medium"
    }
  }

  static func accessory(_ family: WidgetFamily) -> Bool {
    family == .accessoryInline || family == .accessoryRectangular || family == .accessoryCircular
  }

  static func modeName(_ mode: WidgetRenderingMode) -> String {
    switch mode {
    case .accented: return "accented"
    case .vibrant: return "vibrant"
    default: return "full"
    }
  }

  // ---------------------------------------------------------------- widgets

  /// What the X0 widget should draw for one family, or nil for "today's view".
  static func widget(
    kind: String, overrideId: String? = nil, glance: X0Glance?, states: [String: RowState], now: Date,
    family: WidgetFamily, scheme: ColorScheme, mode: WidgetRenderingMode, reduced: Bool, standby: Bool,
    displaySize: CGSize, displayScale: CGFloat, x0: X0Context
  ) -> NLookPlanned? {
    let root = name(family)
    // A board the person picked beats whatever the glance names for the kind; otherwise the glance decides.
    let wanted = overrideId.flatMap { $0.isEmpty ? nil : $0 } ?? glance?.look[kind]
    guard let design = NLookStore.designOrFallback(wanted), design.surface == "widget",
          let node = design.roots[root] else { return nil }
    let named = (glance?.paletteName).flatMap { $0.isEmpty ? nil : $0 }
    let palette = NLookStore.palette(named ?? design.paletteName)
    let colours = palette.scheme(scheme).reduced(reduced)
    let bind = NLookBind(
      surface: "widget", glance: glance, state: nil, vars: glance?.vars ?? [:], now: now,
      lockSafe: accessory(family), states: states)
    let ink = NLookInk(scheme: colours, bot: bind.boundBot, glance: glance)

    // A ROOT'S `bg` IS THE WIDGET'S OWN BACKGROUND, drawn the way the system draws that family's background — never a
    // filled rectangle inside the tree. So it comes out of the tree on EVERY family, and goes back on as:
    //   small / medium / large   the container background. iOS removes a container background in StandBy and on tinted
    //                            and clear Home Screens, and never removes content, so a root that painted its own
    //                            ground would show an opaque slab in exactly the modes meant to be see-through. A root
    //                            that names no `bg` draws as if it said `bg: "ground"` — the one place that rule lives.
    //   rect / circle            the SYSTEM's accessory backdrop, whatever colour the token names. The Lock Screen draws
    //                            accessories in vibrant mode, by brightness: a filled rectangle there is an opaque slab
    //                            the size of the family's frame, square even in the circle slot, which no hand-written
    //                            accessory view has ever drawn. X0Circle composes the same backdrop by hand.
    //   inline                   nothing. The system draws only words and one image there.
    let declared = node.style.bg.flatMap { $0.isEmpty ? nil : $0 }
    // "A root that names no `bg` draws as if it said `bg: ground`" lives HERE and nowhere else: both the container
    // colour and the text rule below read this one name.
    let rootBG = declared ?? "ground"
    let tree = declared == nil ? node : node.withoutBG()
    let isAccessory = accessory(family)
    let backdrop = declared != nil && (family == .accessoryRectangular || family == .accessoryCircular)
    let containerBG: Color? = isAccessory ? nil : ink.color(rootBG)

    // A ROOT'S `bg` COUNTS FOR THE TEXT RULE ONLY WHERE IT IS ACTUALLY PAINTED IN THAT COLOUR. On an accessory root it
    // is not (the system's backdrop is not the token's colour), and on a Home Screen root it is not wherever the system
    // takes the container away — StandBy and the rest. Words there take `ink`, which is what the Lock Screen and StandBy
    // need: a root with `bg: "ink"` would otherwise give its words `ground`, near-black on black.
    let bgRole = isAccessory || standby ? "" : NLookCtx.role(ofBG: rootBG)

    let ctx = NLookCtx(
      root: root, surface: "widget", scheme: colours, palette: palette,
      ink: ink, bind: bind,
      appearance: scheme == .dark ? "dark" : "light", mode: modeName(mode), reduced: reduced, standby: standby,
      accessory: isAccessory, displaySize: displaySize, scale: displayScale, jobId: "", x0: x0,
      bgRole: bgRole)
    NLookStore.mark(design.id)
    return NLookPlanned(
      designId: design.id, node: tree, ctx: ctx, containerBG: containerBG, backdrop: backdrop)
  }

  // ---------------------------------------------------------------- the Live Activity

  /// What one Live Activity region should draw, or nil for today's hand-drawn region. Each region falls back on its own, so
  /// a design that only redraws the banner leaves the island exactly as it is.
  static func activity(
    root: String, job: String, state: BotsAtWorkAttributes.ContentState, glance: X0Glance?, scheme: ColorScheme,
    reduced: Bool, island: Bool
  ) -> NLookPlanned? {
    guard let design = NLookStore.designOrFallback(state.look), design.surface == "activity",
          let node = design.roots[root] else { return nil }
    let palette = NLookStore.palette(island ? "island" : design.paletteName)
    // The island is always black, whatever the phone's appearance.
    let colours = palette.scheme(island ? .dark : scheme).reduced(reduced)
    let bind = NLookBind(
      surface: "activity", glance: glance, state: state, vars: state.vars ?? [:], now: Date(),
      lockSafe: root == "lock", states: NowStates.all(since: glance?.outcomesSince ?? 0))
    let x0 = X0Context(
      g: glance, p: island ? .island : X0Palette.of(scheme).reduced(reduced),
      states: bind.states, now: Date(), rim: island || scheme == .dark)
    let ctx = NLookCtx(
      root: root, surface: "activity", scheme: colours, palette: palette,
      ink: NLookInk(scheme: colours, bot: state.bot, glance: glance), bind: bind,
      appearance: island ? "dark" : (scheme == .dark ? "dark" : "light"), mode: "full", reduced: reduced,
      standby: false, accessory: false,
      displaySize: CGSize(width: island ? 120 : 360, height: island ? 60 : 160), scale: 3, jobId: job, x0: x0,
      bgRole: NLookCtx.role(ofBG: node.style.bg))
    NLookStore.mark(design.id)
    // An Activity region keeps its own background: the banner's ground is already the design's (bannerGround), and the
    // island's regions are drawn inside the system's black capsule rather than in a container of ours.
    return NLookPlanned(designId: design.id, node: node, ctx: ctx, containerBG: nil)
  }

  /// The banner's background, when a design draws the banner: its palette's `ground`, so the whole banner is the design's
  /// and not half today's. nil means today's.
  static func bannerGround(_ state: BotsAtWorkAttributes.ContentState, scheme: ColorScheme) -> Color? {
    guard let design = NLookStore.designOrFallback(state.look), design.surface == "activity",
          design.roots["lock"] != nil else { return nil }
    return NLookStore.palette(design.paletteName).scheme(scheme).ground
  }

  /// The island's keyline, when a design draws any island region: its palette's `accent`. nil means today's bot tint.
  static func keylineTint(_ state: BotsAtWorkAttributes.ContentState) -> Color? {
    guard let design = NLookStore.designOrFallback(state.look), design.surface == "activity",
          design.roots.keys.contains(where: { $0.hasPrefix("island.") || $0.hasPrefix("compact.") }) else { return nil }
    return NLookStore.palette(design.paletteName).scheme(.dark).accent
  }
}

/// A design's root, drawn. Nothing else may build an NLookNodeView for a ROOT: the crash marker is cleared from in here, on
/// the next turn of the main queue, which runs after the snapshot pass in the same process. A render that dies before that
/// leaves its marker behind, and two of those mark the design bad.
struct NLookRootView: View {
  let plan: NLookPlanned

  var body: some View {
    let _ = NLookStore.clearMark()
    // A `rect` or `circle` root that named a background gets the system's own, behind the tree, exactly the way
    // X0Circle composes it. Every other root's background is already elsewhere: the container, or nothing.
    if plan.backdrop {
      ZStack {
        AccessoryWidgetBackground()
        NLookNodeView(node: plan.node, ctx: plan.ctx)
      }
    } else {
      NLookNodeView(node: plan.node, ctx: plan.ctx)
    }
  }
}
